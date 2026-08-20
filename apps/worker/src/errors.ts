export class DeferredJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeferredJobError";
  }
}
