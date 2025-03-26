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
import {
  InstrumentationBase,
  InstrumentationConfig,
  InstrumentationNodeModuleDefinition,
} from '@opentelemetry/instrumentation';
import type * as BatchModule from '@aws-lambda-powertools/batch';
import { PACKAGE_NAME, PACKAGE_VERSION } from './version';
import { Attributes, diag, propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { BaseRecord } from '@aws-lambda-powertools/batch/types';
import { SQSRecord } from 'aws-lambda';
import { ATTR_MESSAGING_MESSAGE_ID } from '@opentelemetry/semantic-conventions/incubating';
import { convertSqsMessageAttributesToObject, extractOpenTelemetrySemanticSpanAttributesFromSQSRecord } from './sqsBatch';

export interface AwsLambdaPowertoolsInstrumentationConfig extends InstrumentationConfig {
}

export class AwsLambdaPowertoolsInstrumentation extends InstrumentationBase {
  constructor(config: InstrumentationConfig = {}) {
    super(PACKAGE_NAME, PACKAGE_VERSION, config);
  }

  init(): InstrumentationNodeModuleDefinition[] {
    diag.debug('Initializing Powertools for AWS Lambda instrumentation');
    return [
      new InstrumentationNodeModuleDefinition(
        '@aws-lambda-powertools/batch',
        ['*'],
        (moduleExports: typeof BatchModule) => {
         diag.debug('Patching BatchProcessor');
          if (typeof moduleExports.BatchProcessor !== 'function') {
            diag.debug('Module does not export a BatchProcessor as function');
            return moduleExports;
          }

          const instrumentation = this;
          
          this._wrap(moduleExports.BatchProcessor.prototype, 'processRecord', (original) => {
            return async function(this: BatchModule.BatchProcessor, record: BaseRecord) {
              diag.debug('Powertools for AWS Lambda - processRecord');
             
              const span = instrumentation.tracer.startSpan('process record', {
                kind: SpanKind.CONSUMER,
              });

              if (this.eventType === "SQS") {
                const sqsRecord = record as SQSRecord;
                const sqsMessageAttributesObject = convertSqsMessageAttributesToObject(sqsRecord.messageAttributes);
                const ctx = propagation.extract(ROOT_CONTEXT, sqsMessageAttributesObject)
                const spanContext = trace.getSpanContext(ctx)
                if (spanContext) {
                  span.addLink({context: spanContext, attributes: { [ATTR_MESSAGING_MESSAGE_ID]: sqsRecord.messageId}})
                }
                const attributes = extractOpenTelemetrySemanticSpanAttributesFromSQSRecord(sqsRecord)
                span.setAttributes(attributes)
              }

              
              try {
                // @ts-ignore
                const result = await original.apply(this, [record]);

                return result;
              } catch (error) {
                 span.setStatus({code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error)})
                throw error;
              } finally {
                span.end();
              }
            };
          });

          return moduleExports;
        },
        // This is for cleanup/unpatch, not ESM-specific
        (moduleExports: any) => {
          if (!moduleExports) return;

          const BatchProcessor =
            moduleExports.default?.BatchProcessor ||
            moduleExports.BatchProcessor;

          if (BatchProcessor) {
            this._unwrap(BatchProcessor.prototype, 'processRecord');
          }
        }
      ),
    ];
  }
}
