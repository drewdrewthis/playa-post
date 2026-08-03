import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';

import { createRedactingSpanProcessor } from './create-redacting-span-processor';

describe('createRedactingSpanProcessor', () => {
  it('drops span attributes outside the allowlist before they reach the delegate exporter (M1-AC11)', () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [
        createRedactingSpanProcessor({
          allowedAttributeKeys: ['http.method'],
          delegate: new SimpleSpanProcessor(exporter),
        }),
      ],
    });

    const tracer = provider.getTracer('observability.unit.test');
    const span = tracer.startSpan('test-span');
    span.setAttribute('http.method', 'GET');
    span.setAttribute('viewerId', 'viewer-123');
    span.setAttribute('bulletin.body', 'secret text');
    span.end();

    const [exported] = exporter.getFinishedSpans();
    expect(exported?.attributes).toEqual({ 'http.method': 'GET' });
  });

  it('keeps every allowlisted attribute', () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [
        createRedactingSpanProcessor({
          allowedAttributeKeys: ['http.method', 'http.status_code'],
          delegate: new SimpleSpanProcessor(exporter),
        }),
      ],
    });

    const tracer = provider.getTracer('observability.unit.test');
    const span = tracer.startSpan('test-span');
    span.setAttribute('http.method', 'GET');
    span.setAttribute('http.status_code', 200);
    span.end();

    const [exported] = exporter.getFinishedSpans();
    expect(exported?.attributes).toEqual({ 'http.method': 'GET', 'http.status_code': 200 });
  });

  it('exports zero attributes when none are allowlisted', () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [
        createRedactingSpanProcessor({
          allowedAttributeKeys: [],
          delegate: new SimpleSpanProcessor(exporter),
        }),
      ],
    });

    const tracer = provider.getTracer('observability.unit.test');
    const span = tracer.startSpan('test-span');
    span.setAttribute('viewerId', 'viewer-123');
    span.end();

    const [exported] = exporter.getFinishedSpans();
    expect(exported?.attributes).toEqual({});
  });
});
