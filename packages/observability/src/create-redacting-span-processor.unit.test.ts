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

  it('drops non-allowlisted attributes on span events added via addEvent', () => {
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
    span.addEvent('bulletin-created', { 'http.method': 'GET', body: 'secret bulletin text' });
    span.end();

    const [exported] = exporter.getFinishedSpans();
    expect(exported?.events).toHaveLength(1);
    expect(exported?.events[0]?.name).toBe('bulletin-created');
    expect(exported?.events[0]?.attributes).toEqual({ 'http.method': 'GET' });
  });

  it('redacts the exception event recorded by recordException', () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [
        createRedactingSpanProcessor({
          allowedAttributeKeys: ['exception.type'],
          delegate: new SimpleSpanProcessor(exporter),
        }),
      ],
    });

    const tracer = provider.getTracer('observability.unit.test');
    const span = tracer.startSpan('test-span');
    span.recordException(new Error('bulletin body leaked into an error message'));
    span.end();

    const [exported] = exporter.getFinishedSpans();
    expect(exported?.events).toHaveLength(1);
    expect(exported?.events[0]?.name).toBe('exception');
    // exception.message and exception.stacktrace are not allowlisted, so only
    // exception.type may survive.
    expect(exported?.events[0]?.attributes).toEqual({ 'exception.type': 'Error' });
  });

  it('drops non-allowlisted attributes on span links', () => {
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
    const linkTarget = tracer.startSpan('link-target');
    linkTarget.end();

    const span = tracer.startSpan('test-span', {
      links: [
        {
          context: linkTarget.spanContext(),
          attributes: { 'http.method': 'GET', viewerId: 'viewer-123' },
        },
      ],
    });
    span.end();

    const exported = exporter.getFinishedSpans().find((finished) => finished.name === 'test-span');
    expect(exported?.links).toHaveLength(1);
    expect(exported?.links[0]?.attributes).toEqual({ 'http.method': 'GET' });
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
