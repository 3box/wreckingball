import { APIGatewayEvent } from "aws-lambda";
import { SQS } from "aws-sdk";

const sqs = new SQS();

export const producer = async (event: APIGatewayEvent) => {
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
    const identifier = body.identifier || `run-${Math.floor(Math.random() * 100000)}`
    const endpoint = body.endpoint
    if (!endpoint) throw new Error(`Must provide endpoint`)
    const promises = Array.from({ length: count }).map((_, index) => {
      return sqs
        .sendMessage({
          QueueUrl: process.env.QUEUE_URL,
          MessageBody: JSON.stringify({identifier, endpoint})
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
};
