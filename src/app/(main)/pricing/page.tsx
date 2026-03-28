"use client";

import { CheckIcon } from "lucide-react";

const plans = [
  {
    name: "Free",
    price: "$0",
    description: "Get started",
    features: ["Limited searches", "Limited leads", "1 project"],
    cta: "Current plan",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$29/mo",
    description: "For power users",
    features: ["More searches", "More leads", "Unlimited projects", "DM outreach"],
    cta: "Coming soon",
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    description: "For teams",
    features: ["Unlimited searches", "Unlimited leads", "Unlimited projects", "Priority support"],
    cta: "Coming soon",
    highlighted: false,
  },
];

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-10 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Pricing</h1>
        <p className="mt-2 text-muted-foreground">Choose a plan that works for you. Change anytime.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={`flex flex-col rounded-xl border p-6 ${
              plan.highlighted ? "border-primary ring-1 ring-primary" : ""
            }`}
          >
            <h2 className="text-lg font-semibold">{plan.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
            <p className="mt-4 text-3xl font-bold tracking-tight">{plan.price}</p>

            <ul className="mt-6 flex-1 space-y-2">
              {plan.features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm">
                  <CheckIcon className="size-4 text-primary" />
                  {f}
                </li>
              ))}
            </ul>

            <div className="mt-6 w-full text-center text-sm text-muted-foreground">
              {plan.cta}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
