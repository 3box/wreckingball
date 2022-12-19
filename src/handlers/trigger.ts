import { APIGatewayEvent, Context } from "aws-lambda";
import { SQS, CloudWatch } from "aws-sdk";

const sqs = new SQS();
const cloudwatch = new CloudWatch();
export const producer = async (event: APIGatewayEvent, context: Context,) => {
  if (!event.body) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "No body was found",
      }),
    };
  }

  try {
    const runID = context.awsRequestId
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

    var params = {
      MetricData: [
          {
              MetricName: 'producer-count',
              Dimensions: [
                  {
                      Name: 'run',
                      Value: runID
                  }
              ],
              Unit: 'None',
              Value: count
          }
      ],
      Namespace: 'CeramicBenchmarkMetrics'
  };

    console.log(await cloudwatch.putMetricData(params).promise())

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Starting ${count} simultaneous requests, run id`,
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
