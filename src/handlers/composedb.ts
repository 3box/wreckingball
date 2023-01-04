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
    const body = JSON.parse(record.body);
    // Case crete new doc
    if (!('streamId' in body)) {
      const seed = randomBytes(32);
      const ceramic = await createCeramic(body.endpoint, seed);
      const model = await Model.create(ceramic, MODEL_DEFINITION)
      const midMetadata = { model: model.id }
      const modelContent = { myData: 0 };
      const doc = await ModelInstanceDocument.create(ceramic, modelContent, midMetadata, undefined, {
        anchor: false,
        publish: false,
      });
      const messageBody = Object.assign({}, body, {
        streamId: doc.id.toString(),
        seed: uint8arrays.toString(seed, "base64url"),
        numberOfUpdatesRequired: body.numberOfUpdatesRequired,
        numberOfReadsRequired: body.numberOfReadsRequired,
      });
      console.log(`Created streamId: `, doc.id.toString());
      console.log(doc.state);
      sqsPromises.push(
        sqs
          .sendMessage({
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify(messageBody),
          })
          .promise()
      );
      console.log(await cloudwatch.putMetricData(createDocMetric(body.identifier)).promise())

    } else if ('streamId' in body && body.numberOfReadsRequired > 0) {
      // Read the doc
      const seed = uint8arrays.fromString(body.seed, "base64url");
      const ceramic = await createCeramic(body.endpoint, seed);
      const doc = await ModelInstanceDocument.load(ceramic, body.streamId);
      const numberOfReadsRemaining = body.numberOfReadsRequired - 1;
      console.log(await cloudwatch.putMetricData(readDocMetric(body.identifier, numberOfReadsRemaining)).promise())
      console.log(`Read streamId: `, doc.id.toString());
      console.log(`numberOfReadsRemaining: `, numberOfReadsRemaining);
      const messageBody = Object.assign({}, body, {
        numberOfReadsRequired: numberOfReadsRemaining,
      });
      await sleep(1 * 1000); // Sleep for 1 second
      if (numberOfReadsRemaining > 0) {
        console.log(`Need to do ${numberOfReadsRemaining} reads`);
        // TODO Randomize
        sqsPromises.push(
          sqs
            .sendMessage({
              QueueUrl: QUEUE_URL,
              MessageBody: JSON.stringify(messageBody),
            })
            .promise()
        );
      } else {
        console.log(`Nothing to do with streamId`, body.streamId);
        return "success";
      }

    } else if ('streamId' in body && body.numberOfUpdatesRequired > 0) {
      // Update the doc
      const seed = uint8arrays.fromString(body.seed, "base64url");
      const ceramic = await createCeramic(body.endpoint, seed);
      const newModelContent = { myData: 1 }; // TODO: get and increment the current value
      const doc = await ModelInstanceDocument.load(ceramic, body.streamId);
      await doc.update(newModelContent, undefined, { anchor: false, publish: false });
      const numberOfUpdatesRemaining = body.numberOfUpdatesRequired - 1;
      console.log(`Updated doc`, doc.id.toString());
      console.log(doc.state);
      console.log(await cloudwatch.putMetricData(updateDocMetric(body.identifier, numberOfUpdatesRemaining)).promise())
      const messageBody = Object.assign({}, body, {
        numberOfUpdatesRequired: numberOfUpdatesRemaining,
      });
      if (numberOfUpdatesRemaining) {
        console.log(`Need to do ${numberOfUpdatesRemaining} updates`);
        // TODO Randomize
        sqsPromises.push(
          sqs
            .sendMessage({
              QueueUrl: QUEUE_URL,
              MessageBody: JSON.stringify(messageBody),
            })
            .promise()
        );
      } else {
        console.log(`Nothing to do with streamId`, body.streamId);
        return "success";
      }
    } else {
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

    const state = 'Starting';
    const numberOfDocs = body.numberOfDocs || 1;
    const numberOfUpdatesRequired = body.numberOfUpdatesRequired || 1;
    const numberOfReadsRequired = body.numberOfReadsRequired || 1;
    const identifier =
      body.identifier || `composedb-run-${Math.floor(Math.random() * 100000)}`;

    const messageBody = JSON.stringify({ state, identifier, endpoint, numberOfDocs, numberOfUpdatesRequired, numberOfReadsRequired });
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