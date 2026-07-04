import { isAxiosError } from "axios"

type FastApiValidationError = {
  loc: Array<string | number>
  msg: string
}

function isValidationErrorList(value: unknown): value is FastApiValidationError[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "object" && item !== null && "msg" in item)
  )
}

export function getErrorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail

    if (typeof detail === "string") {
      return detail
    }

    if (isValidationErrorList(detail)) {
      return detail.map((item) => item.msg).join(" ")
    }

    if (error.code === "ERR_NETWORK") {
      return "Could not reach the server. Check your connection and try again."
    }
  }

  return fallback
}
