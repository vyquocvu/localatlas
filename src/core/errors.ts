export class ConflictError extends Error {
  currentEtag: string | null;

  constructor(message: string, currentEtag: string | null = null) {
    super(message);
    this.name = 'ConflictError';
    this.currentEtag = currentEtag;
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
