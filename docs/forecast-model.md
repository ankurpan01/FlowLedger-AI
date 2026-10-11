# Forecast baseline and evaluation

## Fitting and inference

`app/forecast.py` fits a nonnegative constant daily net-spend rate by least
squares. With imported days treated as a complete record, the fitted coefficient
is the six-month sum of signed category cents divided by the number of calendar
days in those months, clamped at zero. This is a trained statistical mean
baseline, not a neural model or a pretrained fixture. Exact rational arithmetic
and half-up rounding preserve integer cents. It needs no new ML dependency.

The six months immediately preceding the as-of month must each have account
activity; the category needs at least six records and three positive-spend months.
These are minimum conditions to fit/evaluate the baseline, not proof of accurate
prediction. An incomplete statement can still pass these checks. The app assumes
the imported history is complete and explicitly warns about missing purchases.

Training uses only completed months before the selected month. Observed spending
includes saved category records from the month start through the entire selected
UTC day. Transactions after that cutoff are excluded from both observed spending
and training. Remaining-day prediction = fitted rate × days after the cutoff
through month-end. Period total = observed signed cents + remaining prediction.
Only USD is supported for the demo budget comparison. Mixed currencies are not
converted. Refunds affect net spending; the future rate cannot be negative.

The baseline refits on request from owner-scoped database records, without saving
new model or financial rows. The version includes a training-data fingerprint,
so altered training values change the version while added future rows do not.

## Chronological evaluation

There are three expanding-window folds: fit the first three months and evaluate
the fourth, fit four and evaluate the fifth, then fit five and evaluate the sixth.
For each target month, predict days after the same calendar cutoff day (clipped
for shorter months). Compare with actual net spending after that date in the
held-out month. Report the mean absolute cents error of those three predictions.
No target-month or later values enter that fold's training.

This follows the chronological separation described in
[Forecasting: Principles and Practice — time-series cross-validation](https://otexts.com/fpp3/tscv.html).
The error is a point summary, not a calibrated prediction interval or a guarantee.

## Measured seed-data result

The original April–September CSV has 183 calendar days and 15,375 Dining cents.
For October 10, the learned daily rate is 15,375 / 183 cents. Multiplying by 21
days and rounding yields 1,764 cents. No October spending is imported, so period
total is also 1,764 cents. Budget is the user-approved 5,000 cents, not a value
inferred by Gemini.

Held-out July, August and September predictions at the tenth-day cutoff have
errors of 1,702, 1,553 and 1,565 cents respectively; observed remaining Dining
spending is zero in those three fixture months. Rounded MAE is 1,607 cents.
This exposes a real weakness: all six fictional Dining purchases occur early in
the month, while the mean baseline spreads expected spending evenly. The sparse
dataset cannot support claims of reliable real-world accuracy. The UI flags
large error relative to the estimate; further model selection needs richer data
and additional held-out periods rather than tailoring a model to this demo.

## API states

The canonical contract is unchanged. `sufficient` means the fitting/evaluation
minimums were met. `insufficient_history` and `not_trained` return null numeric
prediction, budget, version and accuracy fields. Forecast disablement uses
`FORECAST_ENABLED=false`. Invalid category/date/horizon/currency returns a safe
validation error. A malformed server budget returns a safe configuration error.
