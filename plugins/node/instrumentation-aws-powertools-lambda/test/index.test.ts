/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { AwsLambdaPowertoolsInstrumentation } from '../src';

import { getTestSpans, registerInstrumentationTesting, resetMemoryExporter } from '@opentelemetry/contrib-test-utils';

const instrumentationUnderTest = new AwsLambdaPowertoolsInstrumentation();
registerInstrumentationTesting(instrumentationUnderTest);

import { BatchProcessor, EventType, processPartialResponse } from '@aws-lambda-powertools/batch';
import * as assert from 'assert';


describe('aws-lambda-powertools instrumentation', () => {
  beforeEach(() => {
    resetMemoryExporter();
  });
  it('should create a span for each record', async () => {
    // Arrange
    const processor = new BatchProcessor(EventType.SQS);
    const exampleSqsEvent = {
      Records: [
        {
          body: JSON.stringify({ foo: 'bar' }),
        },
        {
          body: JSON.stringify({ foo: 'bar' }),
        },
      ],
    };
    const recordHandler = async (record: any) => {

    };

    const handler = async (event: any, context: any) =>
      processPartialResponse(event, recordHandler, processor, {
        context,
      });

    // Act
    await handler(exampleSqsEvent, {});

    // Assert
    const spans = getTestSpans();
    assert.equal(spans.length, 2);
  });

  it('should set the messageId as a span attribute', async () => {
    // Arrange
    const processor = new BatchProcessor(EventType.SQS);
    const exampleSqsEvent = {
      Records: [
        { messageId: '123', body: JSON.stringify({ foo: 'bar' }) },
        { messageId: '456', body: JSON.stringify({ foo: 'bar' }) },
      ],
    };
    const recordHandler = async (record: any) => {
      return record.body;
    };

    const handler = async (event: any, context: any) =>   
      processPartialResponse(event, recordHandler, processor, {
        context,
      });

    // Act
    await handler(exampleSqsEvent, {});

    // Assert
    const spans = getTestSpans();
    assert.equal(spans.length, 2);
    assert.equal(spans[0].attributes['aws.lambda.batch.record_id'], '123');
    assert.equal(spans[1].attributes['aws.lambda.batch.record_id'], '456');
  });
});
