import { SQSHandler, SQSEvent } from "aws-lambda";

export async function consumer(event: SQSEvent) {
  for (const record of event.Records) {
    const messageAttributes = record.messageAttributes;
    console.log(
      "Message Attribute: ",
      messageAttributes.AttributeName.stringValue
    );
    console.log("Message Body: ", record.body);
  }
}
