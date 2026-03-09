"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc/client";

export function ImportNetworkForm() {
  const router = useRouter();
  const { data: projects = [] } = trpc.projects.list.useQuery();
  const utils = trpc.useUtils();
  const [networkUsername, setNetworkUsername] = useState("");
  const [networkProjectMode, setNetworkProjectMode] = useState<"new" | "existing">("new");
  const [networkProjectId, setNetworkProjectId] = useState("");
  const [networkProjectName, setNetworkProjectName] = useState("");

  const importMutation = trpc.search.importNetwork.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.projects.list.invalidate(),
        utils.leads.list.invalidate(),
      ]);
      toastManager.add({
        type: "success",
        title: `Imported ${result.leads.length} leads into ${result.project.name}.`,
      });
      router.push(`/leads?project=${result.project.id}`);
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanHandle = networkUsername.replace(/^@/, "").trim();
    if (!cleanHandle) return;

    await importMutation.mutateAsync({
      username: cleanHandle,
      projectId: networkProjectMode === "existing" ? networkProjectId || undefined : undefined,
      projectName:
        networkProjectMode === "new"
          ? networkProjectName.trim() || `${cleanHandle} network`
          : undefined,
    });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div>
        <h2 className="text-[1.45rem] font-semibold tracking-[-0.03em]">Import followers</h2>
        <p className="mt-1.5 text-[0.98rem] text-muted-foreground">
          Import all followers &amp; following from a Twitter account directly into your leads.
        </p>
      </div>

      <div className="space-y-2">
        <label className="block text-[1.05rem] font-semibold">Twitter handle</label>
        <Input
          className="h-[42px] rounded-2xl text-[1rem]"
          placeholder="@MarkKnd"
          value={networkUsername}
          onChange={(event) => setNetworkUsername(event.target.value)}
          required
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <select
          className="flex h-[42px] w-full rounded-2xl border border-input bg-background px-4 text-[1rem] shadow-xs/5"
          value={networkProjectMode}
          onChange={(event) => setNetworkProjectMode(event.target.value as "new" | "existing")}
        >
          <option value="new">Create new project</option>
          <option value="existing">Use existing project</option>
        </select>
        {networkProjectMode === "new" ? (
          <Input
            className="h-[42px] rounded-2xl text-[1rem]"
            placeholder="Project name (optional)"
            value={networkProjectName}
            onChange={(event) => setNetworkProjectName(event.target.value)}
          />
        ) : (
          <select
            className="flex h-[42px] w-full rounded-2xl border border-input bg-background px-4 text-[1rem] shadow-xs/5"
            value={networkProjectId}
            onChange={(event) => setNetworkProjectId(event.target.value)}
            required
          >
            <option value="">Select project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <Button
        type="submit"
        variant="outline"
        className="h-[42px] w-full rounded-2xl text-[1rem] font-medium"
        disabled={importMutation.isPending}
      >
        {importMutation.isPending ? <Spinner className="size-4" /> : null}
        {importMutation.isPending ? "Importing Followers" : "Import Followers"}
      </Button>
    </form>
  );
}
