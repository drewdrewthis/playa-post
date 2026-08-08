import { ApplicationError } from '../../../shared/errors/application-error';

/**
 * A submitted limit is outside the stored vocabulary.
 *
 * One code for both dimensions and both limits on purpose: naming which field failed
 * would be a better developer experience and is not worth a fourth code on a surface
 * where the client owns the picker and can only send an out-of-range value by being
 * wrong about its own options. `message` carries the detail for a human reading a log.
 */
export class PrivacyLimitOutOfRangeError extends ApplicationError {
  constructor(message: string) {
    super('PRIVACY_LIMIT_OUT_OF_RANGE', message);
    this.name = 'PrivacyLimitOutOfRangeError';
  }
}
