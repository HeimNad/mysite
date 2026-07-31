import { ME } from "@/lib/site/me";

export const dynamic = "force-static";

export function GET() {
  return Response.json({
    user: ME.user,
    name: ME.name,
    title: ME.title,
    email: ME.email,
    github: ME.github,
  });
}
