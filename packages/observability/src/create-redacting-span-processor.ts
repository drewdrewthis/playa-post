import type { Attributes, Context } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base';

import { filterAllowedFields } from './filter-allowed-fields';

/** Everything {@link createRedactingSpanProcessor} needs. */
export interface CreateRedactingSpanProcessorOptions {
  /** Attribute key names permitted to reach the delegate, e.g. `http.method`. */
  readonly allowedAttributeKeys: readonly string[];
  /** The real processor (typically wrapping an exporter) that receives the redacted span. */
  readonly delegate: SpanProcessor;
}

/**
 * Wrap a {@link SpanProcessor} so that only allowlisted attribute keys reach
 * it — the OpenTelemetry half of ADR-0002 Q3 ("nothing yet forbids a span
 * attribute carrying a `viewerId`+`ghost_id` pair or a bulletin body in an
 * error trace") and M1-AC11's span-attribute assertion.
 *
 * OTel span attribute values are always primitives or arrays of primitives
 * (never nested objects — that is the wire format's own constraint), so
 * this is a shallow application of {@link filterAllowedFields}; the
 * function is still shared with the logger so "what is safe to emit" has
 * one definition, not two that can drift apart.
 *
 * Attributes are stripped from the span object itself, in place, before
 * delegating — `ReadableSpan.attributes` is the same object the delegate
 * will read when it exports, so redaction has to happen first and on that
 * object, not on a copy.
 *
 * The same allowlist is applied to every attribute surface a span exports:
 * `span.attributes`, each `span.events[*].attributes` (including the
 * `exception` event that `recordException` records — its
 * `exception.message`/`exception.stacktrace` carry whatever an error
 * message interpolated), and each `span.links[*].attributes`.
 *
 * @example
 * ```ts
 * const provider = new BasicTracerProvider({
 *   spanProcessors: [
 *     createRedactingSpanProcessor({
 *       allowedAttributeKeys: ['http.method', 'http.status_code'],
 *       delegate: new SimpleSpanProcessor(otlpExporter),
 *     }),
 *   ],
 * });
 * ```
 */
export function createRedactingSpanProcessor(
  options: CreateRedactingSpanProcessorOptions,
): SpanProcessor {
  const allowedKeys = new Set(options.allowedAttributeKeys);

  const redactInPlace = (attributes: Attributes | undefined): void => {
    if (attributes === undefined) return;
    const filtered = filterAllowedFields(attributes, allowedKeys);
    for (const key of Object.keys(attributes)) {
      if (!Object.hasOwn(filtered, key)) {
        delete attributes[key];
      }
    }
  };

  return {
    onStart(span: Span, parentContext: Context): void {
      options.delegate.onStart(span, parentContext);
    },
    onEnd(span: ReadableSpan): void {
      redactInPlace(span.attributes);
      for (const event of span.events) {
        redactInPlace(event.attributes);
      }
      for (const link of span.links) {
        redactInPlace(link.attributes);
      }
      options.delegate.onEnd(span);
    },
    forceFlush(): Promise<void> {
      return options.delegate.forceFlush();
    },
    shutdown(): Promise<void> {
      return options.delegate.shutdown();
    },
  };
}
