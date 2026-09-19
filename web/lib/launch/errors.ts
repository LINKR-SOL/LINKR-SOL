/** A launch request that was refused for a reason the caller can fix; `status` is the HTTP status routes answer with. */
export class LaunchInputError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "LaunchInputError";
  }
}
