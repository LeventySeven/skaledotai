import { NextRequest, NextResponse } from "next/server";
import { getProjects, createProject } from "@/lib/db";

export async function GET() {
  try {
    const projects = await getProjects();
    return NextResponse.json(projects);
  } catch (err) {
    console.error("[projects GET]", err);
    return NextResponse.json({ error: "Failed to fetch projects." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
  try {
    const project = await createProject(name.trim());
    return NextResponse.json(project);
  } catch (err) {
    console.error("[projects POST]", err);
    return NextResponse.json({ error: "Failed to create project." }, { status: 500 });
  }
}
