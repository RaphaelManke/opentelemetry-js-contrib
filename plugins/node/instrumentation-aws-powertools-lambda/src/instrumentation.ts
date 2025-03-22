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
/** @knipignore */
// import type * as BatchModule from '@aws-lambda-powertools/batch';
import { PACKAGE_NAME, PACKAGE_VERSION } from './version';

export class AwsLambdaPowertoolsInstrumentation extends InstrumentationBase {
  constructor(config: InstrumentationConfig = {}) {
    super(PACKAGE_NAME, PACKAGE_VERSION, config);
  }

  init(): InstrumentationNodeModuleDefinition[] {
    console.log('Initializing AWS Lambda Powertools instrumentation');
    return [
      new InstrumentationNodeModuleDefinition(
        '@aws-lambda-powertools/batch',
        ['*'],
        (moduleExports: any) => {
          console.log('Patching BatchProcessor');

          // Handle both ESM and CommonJS formats in the same function
          const BatchProcessor =
            moduleExports.default?.BatchProcessor || // ESM case
            moduleExports.BatchProcessor; // CommonJS case

          if (typeof BatchProcessor !== 'function') {
            return moduleExports;
          }

          const instrumentation = this;
          this._wrap(BatchProcessor.prototype, 'processRecord', original => {
            return async function (record: any) {
              console.log('patched processRecord');

              const span = instrumentation.tracer.startSpan(
                'aws.lambda.batch.process_record',
                {
                  attributes: {
                    // @ts-ignore
                    'aws.lambda.batch.record_id':
                      record.messageId || record.eventID,
                  },
                }
              );
              try {
                // @ts-ignore
                const result = await original.apply(this, [record]);
                span.setAttributes({
                  'aws.lambda.batch.success': true,
                });
                return result;
              } catch (error) {
                span.setAttributes({
                  'aws.lambda.batch.success': false,
                  'aws.lambda.batch.error':
                    error instanceof Error ? error.message : String(error),
                });
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
