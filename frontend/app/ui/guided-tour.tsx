"use client";
import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useWorkspace } from "./workspace-provider";

const seenKey = "flowledger-tour-v1";
const TourContext = createContext<() => void>(() => {});
const steps = [
  { title: "Welcome to FlowLedger", href: "/", page: "Dashboard", intro: "Turn your saved transactions into a clearer picture of your spending.", tips: ["Start by importing fictional transactions in Documents & Imports.", "Explore totals, set budgets, and ask the assistant questions. Review proposed changes before confirming them.", "This short tour covers every section. Reopen it anytime with Quick tour or from Settings."] },
  { title: "Dashboard: your spending at a glance", href: "/", page: "Dashboard", intro: "Your overview combines saved transactions, category totals, and budget progress.", tips: ["Choose a month to see that month’s spending. Refunds reduce the net total.", "Use the category chart to focus on one type of spending.", "Totals reflect imported records, so missing purchases are not included."] },
  { title: "AI Assistant: ask or request a change", href: "/assistant", page: "AI Assistant", intro: "Ask in everyday language, such as ‘How much did I spend on Dining?’", tips: ["The assistant can explain saved spending and forecasts, or propose supported edits.", "Read the before-and-after preview. Confirm changes saves it; Cancel leaves your data unchanged.", "Saved conversations let you revisit answers. If Gemini is temporarily unavailable, the other pages still work."] },
  { title: "Transactions: see the underlying records", href: "/transactions", page: "Transactions", intro: "Each row is a saved purchase or refund, with a date, merchant, amount, and category.", tips: ["Search or filter to find the records behind a total.", "Changing a row’s category saves immediately. Bulk changes and new transactions use a preview you confirm before saving.", "Positive amounts mean spending; negative amounts mean refunds."] },
  { title: "Analytics: understand past patterns", href: "/analytics", page: "Analytics", intro: "Charts show where your money went and how recorded spending changed over time.", tips: ["Compare categories and switch between daily, weekly, and monthly views.", "These charts describe saved history; they do not predict future purchases.", "A zero means no spending was recorded for that period, which may also mean data is missing."] },
  { title: "Predictive Insights: estimate the rest of a month", href: "/predictions", page: "Predictive Insights", intro: "Choose a category and a date to estimate spending after that date through month-end.", tips: ["Estimated remaining is future spending. Estimated month total adds spending already recorded that month.", "The solid chart line shows recorded totals; the dashed line illustrates the estimate. The budget line is your chosen limit.", "Historical error shows how far past predictions missed. Smaller errors are better, but limited history makes every forecast uncertain."] },
  { title: "Budgets & Goals: make a plan", href: "/planning", page: "Budgets & Goals", intro: "Budgets are monthly spending limits; goals track an amount you want to reach.", tips: ["Set a category budget to compare spending and forecasts with your own limit.", "Record a goal’s target and progress. A goal does not transfer money or connect to a bank.", "Review a proposed change, then confirm it to save your plan."] },
  { title: "Documents & Imports: bring in your history", href: "/documents", page: "Documents & Imports", intro: "Upload a supported CSV, spreadsheet, text file, or text-based PDF with recognizable transaction rows.", tips: ["Check the extracted rows and totals before confirming an import.", "Identical transactions are skipped to help avoid duplicates.", "Scanned PDFs and unsupported layouts may not be readable. Use fictional data for this prototype."] },
  { title: "Settings: preferences, recovery, and help", href: "/settings", page: "Settings", intro: "Name your workspace, control conversational context, and reopen this guide.", tips: ["Conversational context lets the assistant use your last five turns when answering.", "Keep your recovery key private. It can reopen the same workspace in another browser; anyone with the key can access it.", "Ready to explore? Open a section from the sidebar. Quick tour will always be here when you need it."] },
];

export function TourButton({ children = "Quick tour" }: { children?: React.ReactNode }) {
  const open = useContext(TourContext);
  return <button className="secondary tour-trigger" onClick={open}>{children}</button>;
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const { workspace } = useWorkspace();
  const [open, setOpen] = useState(false), [step, setStep] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const checked = useRef(false);
  useEffect(() => {
    if (!workspace || checked.current) return;
    checked.current = true;
    let seen = false;
    try { seen = localStorage.getItem(seenKey) === "seen"; } catch { /* The tour still works without storage. */ }
    if (!seen) Promise.resolve().then(() => setOpen(true));
  }, [workspace]);
  useEffect(() => {
    const modal = dialog.current;
    if (!modal) return;
    if (open && !modal.open) modal.showModal();
    if (!open && modal.open) modal.close();
    if (open) heading.current?.focus();
  }, [open, step]);
  function close() {
    try { localStorage.setItem(seenKey, "seen"); } catch { /* Storage is optional. */ }
    setOpen(false);
  }
  const current = steps[step];
  return <TourContext.Provider value={() => { setStep(0); setOpen(true); }}>
    {children}
    <dialog ref={dialog} className="tour-dialog" aria-labelledby="tour-title" aria-describedby="tour-intro" onCancel={close}>
      <div className="section-heading"><p className="eyebrow">Your FlowLedger guide · {step + 1} of {steps.length}</p><button className="secondary" aria-label="Close tour" onClick={close}>✕</button></div>
      <progress aria-label="Tour progress" value={step + 1} max={steps.length} />
      <h2 ref={heading} tabIndex={-1} id="tour-title">{current.title}</h2>
      <p id="tour-intro" className="tour-intro">{current.intro}</p>
      <ul className="tour-tips">{current.tips.map(tip => <li key={tip}>{tip}</li>)}</ul>
      <Link className="text-link" href={current.href} onClick={close}>Open {current.page} →</Link>
      <div className="tour-actions"><button className="secondary" onClick={close}>Skip / close</button><div className="actions"><button className="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button><button className="primary" onClick={() => step === steps.length - 1 ? close() : setStep(step + 1)}>{step === steps.length - 1 ? "Finish tour" : "Next"}</button></div></div>
      <p className="fine-print">You can replay this guide anytime from the top bar or Settings.</p>
    </dialog>
  </TourContext.Provider>;
}
