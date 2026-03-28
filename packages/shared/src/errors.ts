export class FilterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FilterValidationError';
  }
}
