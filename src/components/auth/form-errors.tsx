import { AlertCircle } from "lucide-react"

export function FormError({ message }: { message?: string }) {
  if (!message) return null

  return (
    <div className="bg-destructive/15 text-destructive border border-destructive/20 rounded-md p-3 text-sm flex items-center gap-2">
      <AlertCircle className="h-4 w-4" />
      {message}
    </div>
  )
}
