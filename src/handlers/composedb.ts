import { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { createCeramic } from "../create-ceramic.js";
import { triggerMetric, createDocMetric, readDocMetric, updateDocMetric, errorMetric } from "./metrics.js";
import { Model, ModelDefinition } from '@ceramicnetwork/stream-model'
import {
  ModelInstanceDocument,
  ModelInstanceDocumentMetadataArgs,
} from '@ceramicnetwork/stream-model-instance'

import * as uint8arrays from "uint8arrays";

import { APIGatewayEvent } from "aws-lambda";
import { SQS, CloudWatch } from "aws-sdk";
import * as process from "process";
import { randomBytes } from "@stablelib/random";

const sqs = new SQS();
const cloudwatch = new CloudWatch();
const lambdaRuntimeSeconds = 90;

const { createLogger, format, transports } = require("winston");

const logLevels = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

const logger = createLogger({
  levels: logLevels,
  transports: [new transports.Console()],
});

const MODEL_DEFINITION: ModelDefinition = {
  name: 'MyModel',
  version: '1.0',
  accountRelation: { type: 'list' },
  schema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    properties: {
      myData: {
        type: 'integer',
        maximum: 10000,
        minimum: 0,
      },
    },
    required: ['myData'],
  },
}

export async function consumer(event: SQSEvent) {
  logger.info("r.0", event.Records.length);
  const sqsPromises: Array<Promise<any>> = [];
  const processingPromises = event.Records.map(async (record) => {

    const queueArn = record.eventSourceARN;
    const QUEUE_URL = queueArn.replace(
      /^arn:aws:sqs:([\w-]+):(\d+):([\w-]+)/g,
      "https://sqs.$1.amazonaws.com/$2/$3"
    );

    let body: Task = JSON.parse(record.body);
    logger.info("records received", { record: record });
    logger.info("parsing passed", { body: body });
    try {
      // Case crete new doc
      switch (body.state) {
        case 'create': {
          const seed = randomBytes(32);
          const ceramic = await createCeramic(body.endpoint, seed);
          const model = await Model.create(ceramic, MODEL_DEFINITION)
          const midMetadata = { model: model.id }
          const modelContent = { myData: 0 };
          const doc = await ModelInstanceDocument.create(ceramic, modelContent, midMetadata, undefined, {
            anchor: body.anchor,
            publish: body.publish,
          });
          logger.info(`Created streamId`, { docID: doc.id.toString(), identifier: body.identifier });
          const readerMessageBody = Object.assign({}, body, {
            state: 'read',
            streamId: doc.id.toString(),
            seed: uint8arrays.toString(seed, "base64url"),
          });
          for (let step = 0; step < body.numberOfReaders; step++) {
            sqsPromises.push(
              sqs
                .sendMessage({
                  QueueUrl: QUEUE_URL,
                  MessageBody: JSON.stringify(readerMessageBody),
                })
                .promise()
            );
          }
          const updateMessageBody = Object.assign({}, body, {
            state: 'update',
            streamId: doc.id.toString(),
            seed: uint8arrays.toString(seed, "base64url"),
          });
          if (body.jobRunUpdateSeconds > 0) {
            sqsPromises.push(
              sqs
                .sendMessage({
                  QueueUrl: QUEUE_URL,
                  MessageBody: JSON.stringify(updateMessageBody),
                })
                .promise()
            );
          }
          logger.info(await cloudwatch.putMetricData(createDocMetric(body.identifier)).promise());
        }
          break;
        case 'read': {
          logger.info(`Reading case`, { read_msLeft: (body.jobRunReadSeconds * 1000) - (Date.now() - body.jobStartTimestamp), identifier: body.identifier });
          while ((body.jobRunReadSeconds * 1000) - (Date.now() - body.jobStartTimestamp) > 0) {
            logger.info(`lambdaRuntime check`, { lambdaMsleft: (lambdaRuntimeSeconds * 1000 * body.generation) - (Date.now() - body.jobStartTimestamp), identifier: body.identifier });

            if ((Date.now() - body.jobStartTimestamp) > (lambdaRuntimeSeconds * 1000 * body.generation)) {
              body.generation += 1; // TODO: this is showing up as generation 4 on the first iteration?!?
              logger.info(`Read lamdba timeout almost reached, resubmitting`, { identifier: body.identifier });
              sqsPromises.push(
                sqs
                  .sendMessage({
                    QueueUrl: QUEUE_URL,
                    MessageBody: JSON.stringify(body),
                  })
                  .promise()
              );
              return "lambda timeout"
            }
            const msLeft = (body.jobRunReadSeconds * 1000) - (Date.now() - body.jobStartTimestamp);
            logger.info(`Start read streamId`, { streamID: body.streamId, read_msLeft: msLeft, identifier: body.identifier });
            const seed = uint8arrays.fromString(body.seed, "base64url");
            const ceramic = await createCeramic(body.endpoint, seed);
            const doc = await ModelInstanceDocument.load(ceramic, body.streamId);
            logger.info(await cloudwatch.putMetricData(readDocMetric(body.identifier)).promise());
            logger.info(`Done read streamId`, { docID: doc.id.toString(), identifier: body.identifier });
            // TODO Randomize
            await sleep(1 * 1000); // Sleep for 1 second
          }
          logger.info(`Read time expired, completed reading streamId`, { streamID: body.streamId, identifier: body.identifier });
        }
          break;
        case 'update': {
          logger.info(`Update case`, { update_msLeft: (body.jobRunUpdateSeconds * 1000) - (Date.now() - body.jobStartTimestamp), identifier: body.identifier });
          while ((body.jobRunUpdateSeconds * 1000) - (Date.now() - body.jobStartTimestamp) > 0) {
            logger.info(`lambdaRuntime check`, { lambdaMsleft: (lambdaRuntimeSeconds * 1000 * body.generation) - (Date.now() - body.jobStartTimestamp), identifier: body.identifier });

            if ((Date.now() - body.jobStartTimestamp) > (lambdaRuntimeSeconds * 1000 * body.generation)) {
              body.generation += 1; // TODO: this is showing up as generation 4 on the first iteration?!?
              logger.info(`Update lamdba timeout almost reached, resubmitting`, { identifier: body.identifier });
              sqsPromises.push(
                sqs
                  .sendMessage({
                    QueueUrl: QUEUE_URL,
                    MessageBody: JSON.stringify(body),
                  })
                  .promise()
              );
              return "lambda timeout"
            }

            const msLeft = (body.jobRunUpdateSeconds * 1000) - (Date.now() - body.jobStartTimestamp);
            logger.info(`Start update streamId`, { update_msLeft: msLeft, streamID: body.streamId, identifier: body.identifier });
            const seed = uint8arrays.fromString(body.seed, "base64url");
            const ceramic = await createCeramic(body.endpoint, seed);
            const doc = await ModelInstanceDocument.load(ceramic, body.streamId);
            const newModelContent = { myData: 1 }; // TODO: get and increment the current value
            await doc.replace(newModelContent)
            await doc.sync()
            //await doc.update(newModelContent, undefined, { anchor: false, publish: false });
            logger.info(await cloudwatch.putMetricData(updateDocMetric(body.identifier)).promise())
            logger.info(`Done update streamId`, { streamID: body.streamId, identifier: body.identifier });

          }
          logger.info(`Update time expired, completed updating streamId`, { streamID: body.streamId, identifier: body.identifier });
        }
          break;
        default:
          logger.error(`Should never be here, generate an error?`, { identifier: body.identifier });
      }
    } catch (error) {
      logger.info(error.code)
      const errorCode = categorzieError(error);
      logger.info(await cloudwatch.putMetricData(errorMetric(body.identifier, errorCode)).promise())
      logger.error(error);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: error,
        }),
      };
    }
  });
  await Promise.all(processingPromises);
  await Promise.all(sqsPromises);
}

export async function trigger(event: APIGatewayEvent) {
  if (!event.body) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "No body was found",
      }),
    };
  }

  try {
    const body: Task  = JSON.parse(event.body);
    const endpoint = body.endpoint;
    if (!endpoint) throw new Error(`Must provide endpoint`);

    const state = 'create';
    const anchor = body.anchor || false;
    const publish = body.publish || false;
    const numberOfDocs = body.numberOfDocs || 1;
    const numberOfReaders = body.numberOfReaders || 1;
    const jobRunReadSeconds = body.jobRunReadSeconds || 60;
    const jobRunUpdateSeconds = body.jobRunUpdateSeconds || 0;
    const jobStartTimestamp = Date.now();
    const generation = 1;
    const identifier =
      body.identifier || `composedb-run-${Math.floor(Math.random() * 100000)}`;

    const messageBody = JSON.stringify({ state, anchor, publish, generation, identifier, endpoint, numberOfDocs, numberOfReaders, jobRunReadSeconds, jobRunUpdateSeconds, jobStartTimestamp });
    logger.info("queue_url", { queue_url: process.env.QUEUE_URL });
    logger.info("message_body", { message_body: messageBody });
    const maxBatchSize = 100;
    const batchCadanceMS = 1000;
    for (let i = 0; i < numberOfDocs / maxBatchSize; i++) {
      const batchSize = Math.min(maxBatchSize, numberOfDocs)
      logger.info("batching creates", { batch_number: i, batch_size: batchSize, batchCadanceMS: batchCadanceMS });
      const promises = Array.from({ length: batchSize }).map((_, index) => {
        return sqs
          .sendMessage({
            QueueUrl: process.env.QUEUE_URL,
            MessageBody: messageBody,
          })
          .promise();
      });
      await Promise.all(promises);
      await sleep(batchCadanceMS);
    }

    logger.info(await cloudwatch.putMetricData(triggerMetric(identifier, numberOfDocs)).promise())

    return {
      statusCode: 200,
      body: messageBody
    };
  } catch (error) {
    logger.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error,
      }),
    };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function categorzieError(error) {
  let errorCode = 'unknown';
  switch (error.code) {
    case 'ECONNREFUSED':
      errorCode = 'ECONNREFUSED';
      break;
    case 'ECONNRESET':
      errorCode = 'ECONNRESET';
      break;
  }
  return errorCode;
}

interface Task {
  state: string;
  anchor: boolean;
  publish: boolean;
  generation: number;
  seed: string;
  streamId: string;
  identifier: string;
  endpoint: string;
  numberOfDocs: number;
  numberOfReaders: number;
  jobRunReadSeconds: number;
  jobRunUpdateSeconds: number;
  jobStartTimestamp: number;
}

