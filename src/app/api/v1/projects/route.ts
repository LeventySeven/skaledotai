import { NextRequest, NextResponse } from "next/server";
import { getProjects, createProject } from "@/lib/db";
import { withApiKey } from "@/lib/withApiKey";

async function getHandler() {
  try {
    const projects = await getProjects();
    return NextResponse.json(projects);
  } catch {
    return NextResponse.json({ error: "Failed to fetch projects." }, { status: 500 });
  }
}

async function postHandler(req: NextRequest) {
  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
  try {
    const project = await createProject(name.trim());
    return NextResponse.json(project);
  } catch {
    return NextResponse.json({ error: "Failed to create project." }, { status: 500 });
  }
}

export const GET = withApiKey(getHandler);
export const POST = withApiKey(postHandler);
