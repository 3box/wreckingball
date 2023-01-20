import { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { createCeramic } from "../create-ceramic.js";
import { triggerMetric, createDocMetric, readDocMetric, updateDocMetric } from "./metrics.js";
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

const MODEL_DEFINITION: ModelDefinition = {
  name: 'MyModel',
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
  console.log("r.0", event.Records.length);
  const sqsPromises: Array<Promise<any>> = [];
  const processingPromises = event.Records.map(async (record) => {
    const queueArn = record.eventSourceARN;
    const QUEUE_URL = queueArn.replace(
      /^arn:aws:sqs:([\w-]+):(\d+):([\w-]+)/g,
      "https://sqs.$1.amazonaws.com/$2/$3"
    );

    console.log("r", record);
    let body: Task = JSON.parse(record.body);
    console.log("parsing passed", body);
    // Case crete new doc
    switch (body.state) {
      case 'create': {
        const seed = randomBytes(32);
        const ceramic = await createCeramic(body.endpoint, seed);
        const model = await Model.create(ceramic, MODEL_DEFINITION)
        const midMetadata = { model: model.id }
        const modelContent = { myData: 0 };
        const doc = await ModelInstanceDocument.create(ceramic, modelContent, midMetadata, undefined, {
          anchor: true,
          publish: true,
        });
        console.log(`Created streamId: `, doc.id.toString());
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
        console.log(await cloudwatch.putMetricData(createDocMetric(body.identifier)).promise());
      }
        break;
      case 'read': {
        console.log(`read msLeft: `, (body.jobRunReadSeconds * 1000) - (Date.now() - body.jobStartTimestamp));
        while ((body.jobRunReadSeconds * 1000) - (Date.now() - body.jobStartTimestamp) > 0) {
          console.log(`lambdaRuntime left : `, (lambdaRuntimeSeconds * 1000 * body.generation) - (Date.now() - body.jobStartTimestamp));

          if ((Date.now() - body.jobStartTimestamp) > (lambdaRuntimeSeconds * 1000 * body.generation)) {
            body.generation += 1; // TODO: this is showing up as generation 4 on the first iteration?!?
            console.log(`Read lamdba timeout almost reached, resubmitting`);
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
          console.log(`read msLeft: `, msLeft);
          const seed = uint8arrays.fromString(body.seed, "base64url");
          const ceramic = await createCeramic(body.endpoint, seed);
          const doc = await ModelInstanceDocument.load(ceramic, body.streamId);
          console.log(await cloudwatch.putMetricData(readDocMetric(body.identifier)).promise());
          console.log(`Read streamId: `, doc.id.toString());
          // TODO Randomize
          await sleep(1 * 1000); // Sleep for 1 second
        }
        console.log(`Done reading streamId`, body.streamId);
      }
        break;
      case 'update': {
        console.log(`update msLeft: `, (body.jobRunUpdateSeconds * 1000) - (Date.now() - body.jobStartTimestamp));
        while ((body.jobRunUpdateSeconds * 1000) - (Date.now() - body.jobStartTimestamp) > 0) {
          console.log(`lambdaRuntime left : `, (lambdaRuntimeSeconds * 1000 * body.generation) - (Date.now() - body.jobStartTimestamp));

          if ((Date.now() - body.jobStartTimestamp) > (lambdaRuntimeSeconds * 1000 * body.generation)) {
            body.generation += 1; // TODO: this is showing up as generation 4 on the first iteration?!?
            console.log(`Update lamdba timeout almost reached, resubmitting`);
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
          console.log(`update msLeft: `, msLeft);
          const seed = uint8arrays.fromString(body.seed, "base64url");
          const ceramic = await createCeramic(body.endpoint, seed);
          const doc = await ModelInstanceDocument.load(ceramic, body.streamId);
          const newModelContent = { myData: 1 }; // TODO: get and increment the current value
          await doc.replace(newModelContent)
          await doc.sync()
          //await doc.update(newModelContent, undefined, { anchor: false, publish: false });
          console.log(`Updated doc`, doc.id.toString());
          console.log(await cloudwatch.putMetricData(updateDocMetric(body.identifier)).promise())

        }
        console.log(`Done updating streamId`, body.streamId);
      }
        break;
      default:
        console.log(`Should never be here, generate an error?`);
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
    const body = JSON.parse(event.body);
    const endpoint = body.endpoint;
    if (!endpoint) throw new Error(`Must provide endpoint`);

    const state = 'create';
    const numberOfDocs = body.numberOfDocs || 1;
    const numberOfReaders = body.numberOfReaders || 1;
    const jobRunReadSeconds = body.jobRunReadSeconds || 60;
    const jobRunUpdateSeconds = body.jobRunUpdateSeconds || 0;
    const jobStartTimestamp = Date.now();
    const generation = 1;
    const identifier =
      body.identifier || `composedb-run-${Math.floor(Math.random() * 100000)}`;

    const messageBody = JSON.stringify({ state, generation, identifier, endpoint, numberOfDocs, numberOfReaders, jobRunReadSeconds, jobRunUpdateSeconds, jobStartTimestamp });
    console.log("queue_url", process.env.QUEUE_URL);
    const promises = Array.from({ length: numberOfDocs }).map((_, index) => {
      return sqs
        .sendMessage({
          QueueUrl: process.env.QUEUE_URL,
          MessageBody: messageBody,
        })
        .promise();
    });
    await Promise.all(promises);

    console.log(await cloudwatch.putMetricData(triggerMetric(identifier, numberOfDocs)).promise())

    return {
      statusCode: 200,
      body: messageBody
    };
  } catch (error) {
    console.log(error);
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

interface Task {
  state: string;
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