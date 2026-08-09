import { z } from 'zod';

import { VISIBLE_TO_DISTANCE } from '../domain/visible-to-distance';

/**
 * `identity.visibility.set`'s input.
 *
 * The enum is restated from the domain's vocabulary rather than from
 * `@playa-post/contracts` — modules never import the contracts package, and
 * `contracts-api-parity.fitness.test.ts` is what holds this schema and the contract's
 * `VisibleToDistance` union together at type level.
 *
 * **No `userId` field, here or anywhere** (ADR-0002:180-181): whose setting this is
 * comes from the verified token, so a caller can only ever move its own dial.
 */
export const setVisibilityInput = z.object({
  visibleToDistance: z.enum([
    VISIBLE_TO_DISTANCE.first,
    VISIBLE_TO_DISTANCE.second,
    VISIBLE_TO_DISTANCE.third,
    VISIBLE_TO_DISTANCE.sixth,
  ]),
});

export type SetVisibilityInput = z.infer<typeof setVisibilityInput>;
