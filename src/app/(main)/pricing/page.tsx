"use client";

import { PLANS } from "@/lib/autumn";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { CheckIcon } from "lucide-react";

const plans = [
  {
    id: PLANS.FREE,
    name: "Free",
    price: "$0",
    description: "Get started",
    features: ["Limited searches", "Limited leads", "1 project"],
    cta: "Current plan",
    highlighted: false,
  },
  {
    id: PLANS.PRO,
    name: "Pro",
    price: "$29/mo",
    description: "For power users",
    features: ["More searches", "More leads", "Unlimited projects", "DM outreach"],
    cta: "Upgrade to Pro",
    highlighted: true,
  },
  {
    id: PLANS.ENTERPRISE,
    name: "Enterprise",
    price: "Custom",
    description: "For teams",
    features: ["Unlimited searches", "Unlimited leads", "Unlimited projects", "Priority support"],
    cta: "Contact us",
    highlighted: false,
  },
];

export default function PricingPage() {
  const attach = trpc.billing.attach.useMutation();

  const handleUpgrade = async (planId: string) => {
    if (planId === PLANS.FREE) return;
    const result = await attach.mutateAsync({ planId });
    if (result.paymentUrl) {
      window.location.href = result.paymentUrl;
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-10 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Pricing</h1>
        <p className="mt-2 text-muted-foreground">Choose a plan that works for you. Change anytime.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {plans.map((plan) => (
          <div
            key={plan.id}
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

            <Button
              className="mt-6 w-full"
              variant={plan.highlighted ? "default" : "outline"}
              disabled={plan.id === PLANS.FREE || attach.isPending}
              onClick={() => handleUpgrade(plan.id)}
            >
              {attach.isPending ? "Loading..." : plan.cta}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
