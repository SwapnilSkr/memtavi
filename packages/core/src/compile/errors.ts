export class CompileError extends Error {
  readonly code = "invalid_output";
  readonly status = 422;
  readonly transient = false;

  constructor() {
    super("Compiler output failed validation");
    this.name = "CompileError";
  }
}
