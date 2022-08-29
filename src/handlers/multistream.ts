import { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { createCeramic } from "../create-ceramic.js";
import { TileDocument } from "@ceramicnetwork/stream-tile";
import * as uint8arrays from "uint8arrays";

import { APIGatewayEvent } from "aws-lambda";
import { SQS } from "aws-sdk";
import * as process from "process";
import { randomBytes } from "@stablelib/random";

const sqs = new SQS();

export async function consumer(event: SQSEvent) {
  for (const record of event.Records) {
    const queueArn = record.eventSourceARN;
    const QUEUE_URL = queueArn.replace(
      /^arn:aws:sqs:([\w-]+):(\d+):([\w-]+)/g,
      "https://sqs.$1.amazonaws.com/$2/$3"
    );
    console.log("queueUrl", QUEUE_URL);

    console.log("r", record);
    const body = JSON.parse(record.body);
    if (body.streamId) {
      // Update tile
      const seed = uint8arrays.fromString(body.seed, "base64url");
      const ceramic = await createCeramic(body.endpoint, seed);
      const tile = await TileDocument.load(ceramic, body.streamId);
      const content1 = { foo: `world-${Math.random()}` };
      await tile.update(content1, undefined, { anchor: false, publish: false });
      console.log(`Updated tile`, tile.id.toString());
      console.log(tile.state);
      const hopsRemaining = body.hops - 1
      const messageBody = Object.assign({}, body, {
        hops: hopsRemaining,
      });
      if (hopsRemaining) {
        console.log(`Need to do ${hopsRemaining} hops`)
        // TODO Randomize
        await sqs
            .sendMessage({
              QueueUrl: QUEUE_URL,
              MessageBody: JSON.stringify(messageBody),
            })
            .promise();
      } else {
        console.log(`Nothing to do with streamId`, body.streamId);
        return "success"
      }
    } else {
      // Create Tile
      const seed = randomBytes(32);
      const ceramic = await createCeramic(body.endpoint, seed);

      const content0 = {
        foo: `hello-${Math.random()}`,
      };
      const tile = await TileDocument.create(ceramic, content0, undefined, {
        anchor: false,
        publish: false,
      });
      const messageBody = Object.assign({}, body, {
        streamId: tile.id.toString(),
        seed: uint8arrays.toString(seed, "base64url"),
      });
      console.log(`Created a stream id`, tile.id.toString());
      console.log(tile.state);
      await sqs
        .sendMessage({
          QueueUrl: QUEUE_URL,
          MessageBody: JSON.stringify(messageBody),
        })
        .promise();
    }
    // const ceramic = await createCeramic(body.endpoint);
    //
    // const content0 = {
    //   foo: `hello-${Math.random()}`,
    // };
    // const tile = await TileDocument.create(ceramic, content0, undefined, {
    //   anchor: false,
    //   publish: false,
    // });
    // const content1 = { foo: `world-${Math.random()}` };
    // await tile.update(content1, undefined, { anchor: false, publish: false });
    //
    // console.log("ceramic payload:", tile.state);
  }
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
    const count = body.count || 1;
    const identifier =
      body.identifier || `run-${Math.floor(Math.random() * 100000)}`;
    const hops = body.hops || 1;
    const endpoint = body.endpoint;
    if (!endpoint) throw new Error(`Must provide endpoint`);
    const messageBody = JSON.stringify({ identifier, endpoint, hops });
    console.log("queue_url", process.env.QUEUE_URL);
    const promises = Array.from({ length: count }).map((_, index) => {
      return sqs
        .sendMessage({
          QueueUrl: process.env.QUEUE_URL,
          MessageBody: messageBody,
        })
        .promise();
    });
    await Promise.all(promises);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Starting ${count} simultaneous requests`,
        count: count,
      }),
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
