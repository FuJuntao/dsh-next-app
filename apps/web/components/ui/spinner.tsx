import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"
import { RiLoaderLine } from "@remixicon/react"

// Props of the wrapped icon, not ComponentProps<"svg">: the remixicon props
// type is narrower (e.g. color?: string), and spreading svg-typed props into
// it fails the repo's exactOptionalPropertyTypes.
type SpinnerProps = ComponentProps<typeof RiLoaderLine>

function Spinner({ className, ...props }: SpinnerProps) {
  return (
    <RiLoaderLine data-slot="spinner" role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
