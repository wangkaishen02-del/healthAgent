export type AssistantToolExecutionRecord = {
  tool: string;
  result: unknown;
};

export function isAssistantOperationError(result: unknown) {
  return Boolean(result && typeof result === "object"
    && (result as { type?: unknown }).type === "operation_error");
}

export function summarizeAssistantToolResults(
  records: AssistantToolExecutionRecord[],
  fallback: unknown,
) {
  if (records.length === 0) return fallback;
  if (records.length === 1) return records[0].result;
  return {
    type: "operation_batch",
    success: records.every((record) => !isAssistantOperationError(record.result)),
    results: records,
  };
}
