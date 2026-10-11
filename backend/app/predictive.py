"""Chronological model comparison and safe JSON model persistence (no pickle)."""
import calendar
import hashlib
import json
import math
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from app.db import transactions
from app.planning import models, PlanningService
from app.workspace import private_owner
from app.forecast import ForecastRequest, ForecastService, month_shift

FEATURES = ['day_of_month', 'days_remaining', 'spent_to_date_cents', 'transaction_count', 'mean_purchase_cents', 'previous_month_cents', 'historical_daily_rate_cents', 'spending_velocity_cents']
CANDIDATES = ['daily_mean', 'previous_month', 'linear', 'ridge', 'random_forest', 'gradient_boosting']

def features(months, index, day):
    target = months[index]
    observed = [r for r in target['rows'] if r['day'] <= day]
    spent = sum(r['amount'] for r in observed)
    prior = months[:index]
    rate = sum(m['total'] for m in prior) / max(1, sum(m['days'] for m in prior))
    return [day, target['days'] - day, spent, len(observed), spent / max(1,len(observed)), prior[-1]['total'] if prior else 0, rate, spent / max(1,day)]

def train(name, X, y, months):
    if name == 'daily_mean':
        return {'type':'rate','rate':max(0,sum(m['total'] for m in months)/sum(m['days'] for m in months))}
    if name == 'previous_month':
        return {'type':'previous'}
    from sklearn.linear_model import LinearRegression, Ridge
    from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
    from sklearn.preprocessing import StandardScaler
    if name in {'linear','ridge'}:
        scale=StandardScaler().fit(X)
        model=(LinearRegression() if name=='linear' else Ridge(alpha=10)).fit(scale.transform(X),y)
        return {'type':'linear','mean':scale.mean_.tolist(),'scale':scale.scale_.tolist(),'coef':model.coef_.tolist(),'intercept':float(model.intercept_)}
    model=(RandomForestRegressor(n_estimators=40,max_depth=3,min_samples_leaf=2,random_state=42,n_jobs=1) if name=='random_forest'
        else GradientBoostingRegressor(n_estimators=40,max_depth=2,min_samples_leaf=2,learning_rate=0.05,random_state=42)).fit(X,y)
    trees=model.estimators_ if name=='random_forest' else [t[0] for t in model.estimators_]
    output=[]
    for tree in trees:
        t=tree.tree_
        output.append({'left':t.children_left.tolist(),'right':t.children_right.tolist(),'feature':t.feature.tolist(),'threshold':t.threshold.tolist(),'value':t.value[:,0,0].tolist()})
    return {'type':'forest' if name=='random_forest' else 'boost','trees':output,
        'base':0 if name=='random_forest' else float(model.init_.constant_[0,0]), 'learning_rate':1 if name=='random_forest' else model.learning_rate}

def infer(artifact, x):
    kind=artifact['type']
    if kind=='rate':
        value=artifact['rate']*x[1]
    elif kind=='previous':
        value=max(0,x[5]-x[2])
    elif kind=='linear':
        value=artifact['intercept']+sum(c*(v-m)/s for c,v,m,s in zip(artifact['coef'],x,artifact['mean'],artifact['scale']))
    else:
        predictions=[]
        for t in artifact['trees']:
            node=0
            while t['left'][node]!=-1:
                node=t['left'][node] if x[t['feature'][node]] <= t['threshold'][node] else t['right'][node]
            predictions.append(t['value'][node])
        value=sum(predictions)/len(predictions) if kind=='forest' else artifact['base']+artifact['learning_rate']*sum(predictions)
    return max(0, min(100_000_000, int(math.floor(value+0.5))))

def examples(months, max_index):
    X,y=[],[]
    for i in range(1,max_index):
        for day in [5,10,20]:
            X.append(features(months,i,day));y.append(sum(r['amount'] for r in months[i]['rows'] if r['day']>day))
    return X,y

def metrics(predictions, actuals):
    errors=[p-a for p,a in zip(predictions,actuals)]
    denom=sum(abs(a) for a in actuals)
    return {'mae_cents':round(sum(abs(e) for e in errors)/len(errors)),
        'rmse_cents':round(math.sqrt(sum(e*e for e in errors)/len(errors))),
        'wape':sum(abs(e) for e in errors)/denom if denom else None, 'validation_points':len(errors)}

class PredictiveService:
    def __init__(self, engine, identity):
        self.engine,self.identity=engine,identity

    def predict(self, request):
        baseline=ForecastService(self.engine,self.identity).forecast(request)
        if baseline['data_quality']!='sufficient':
            return {'forecast':baseline,'evaluation':[],'trajectory':[],'methodology':'Six consecutive active months and at least six category transactions are required.'}
        current=request.as_of.replace(day=1); start=month_shift(current,-6)
        cutoff=datetime.combine(request.as_of+timedelta(days=1),datetime.min.time(),timezone.utc)
        with self.engine.connect() as c:
            rows=c.execute(select(transactions).where(transactions.c.owner_id==self.identity,
                transactions.c.category==request.category,transactions.c.occurred_at>=datetime.combine(start,datetime.min.time(),timezone.utc),
                transactions.c.occurred_at<cutoff).order_by(transactions.c.occurred_at,transactions.c.id)).mappings().all()
        fingerprint=hashlib.sha256(json.dumps(['comparison-v1',self.identity,request.category,request.as_of.isoformat(),
            [[r['occurred_at'].isoformat(),r['amount_cents']] for r in rows]],separators=(',',':')).encode()).hexdigest()
        id='ml-'+fingerprint
        with self.engine.connect() as c:
            cached=c.scalar(select(models.c.artifact).where(models.c.id==id,models.c.owner_id==self.identity))
        months=[]
        for i in range(7):
            month=month_shift(start,i)
            observed=[{'day':r['occurred_at'].day,'amount':r['amount_cents']} for r in rows if r['occurred_at'].date().replace(day=1)==month]
            months.append({'month':month.isoformat()[:7],'days':calendar.monthrange(month.year,month.month)[1], 'rows':observed,'total':sum(r['amount'] for r in observed)})
        if not cached:
            evaluation=[]
            # Model selection folds July/August; September is untouched final evaluation.
            selection_predictions={name:[] for name in CANDIDATES}; selection_actual=[]
            for index in [3,4]:
                X,y=examples(months,index)
                day=min(request.as_of.day,months[index]['days'])
                x=features(months,index,day)
                selection_actual.append(sum(r['amount'] for r in months[index]['rows'] if r['day']>day))
                for name in CANDIDATES:
                    model=train(name,X,y,months[:index]);selection_predictions[name].append(infer(model,x))
            # Prefer the simpler baseline on a tie; no selection using the final holdout.
            scores={name:metrics(selection_predictions[name],selection_actual) for name in CANDIDATES}
            winner=min(CANDIDATES,key=lambda n:scores[n]['mae_cents'])
            X,y=examples(months,5); x=features(months,5,min(request.as_of.day,months[5]['days']))
            actual=sum(r['amount'] for r in months[5]['rows'] if r['day']>request.as_of.day)
            final_model=train(winner,X,y,months[:5]); final_prediction=infer(final_model,x)
            for name in CANDIDATES:
                evaluation.append({'model':name,**scores[name], 'selection_predictions_cents':selection_predictions[name], 'selection_actual_cents':selection_actual})
            X,y=examples(months,6)
            cached={'selected_model':winner,'fitted':train(winner,X,y,months[:6]),'evaluation':evaluation,
                'holdout':{'month':months[5]['month'],'predicted_cents':final_prediction,'actual_cents':actual,'absolute_error_cents':abs(final_prediction-actual)},
                'features':FEATURES,'selection_mae_cents':scores[winner]['mae_cents'], 'training_examples':len(X)}
            insert=pg_insert if self.engine.dialect.name=='postgresql' else sqlite_insert
            with self.engine.begin() as c:
                c.execute(insert(models).values(id=id,owner_id=self.identity,category=request.category,artifact=cached,
                    created_at=datetime.now(timezone.utc)).on_conflict_do_nothing(index_elements=['id']))
                cached=c.scalar(select(models.c.artifact).where(models.c.id==id))
        x=features(months,6,request.as_of.day)
        prediction=infer(cached['fitted'],x) if request.horizon_days else 0
        spent=x[2]
        budget=next((b['amount_cents'] for b in PlanningService(self.engine,self.identity).read()['budgets'] if b['category']==request.category),None)
        forecast={**baseline,'forecast_remaining_cents':prediction,'predicted_period_total_cents':spent+prediction,
            'budget_cents':budget,'backtest_mae_cents':cached['selection_mae_cents'],'model_version':cached['selected_model']+'-v1-'+fingerprint[:12]}
        trajectory=[]; cumulative=0
        for day in range(1,months[6]['days']+1):
            if day<=request.as_of.day:
                cumulative+=sum(r['amount'] for r in months[6]['rows'] if r['day']==day)
                trajectory.append({'day':day,'observed_cents':cumulative,'projected_cents':None})
            else:
                trajectory.append({'day':day,'observed_cents':None,'projected_cents':round(spent+prediction*(day-request.as_of.day)/max(1,request.horizon_days))})
        return {'forecast':forecast,'evaluation':cached['evaluation'],'holdout':cached['holdout'],'selected_model':cached['selected_model'],
            'training_examples':cached['training_examples'],'features':FEATURES,'trajectory':trajectory,
            'risk_probability':None,'uncertainty_interval':None,
            'methodology':'Chronological expanding-window model selection on months 4 and 5; month 6 is an untouched final holdout. Each fit sees only earlier completed months. Final model is refitted on six months and loaded from its JSON database artifact. Very few validation periods: reliability is limited.',
            'trajectory_note':'Observed cumulative purchases through the selected date; dashed future line distributes the remaining-total estimate evenly, not a daily forecast. No calibrated probability or confidence interval is available.'}

def make_predictive_router(engine):
    router=APIRouter()
    @router.post('/ml/insights')
    def predict(body:ForecastRequest,identity=Depends(private_owner)):
        return PredictiveService(engine,identity).predict(body)
    return router
