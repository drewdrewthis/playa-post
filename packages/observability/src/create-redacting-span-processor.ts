import type { Context } from '@opentelemetry/api';
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

  return {
    onStart(span: Span, parentContext: Context): void {
      options.delegate.onStart(span, parentContext);
    },
    onEnd(span: ReadableSpan): void {
      const filtered = filterAllowedFields(span.attributes, allowedKeys);
      for (const key of Object.keys(span.attributes)) {
        if (!(key in filtered)) {
          delete span.attributes[key];
        }
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
