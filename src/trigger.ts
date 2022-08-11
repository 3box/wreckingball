export async function hello (event) {
    return {
        statusCode: 200,
        body: JSON.stringify(
            {
                message: "Hello Serverless v3.0! Your function executed successfully!",
                input: event,
            },
            null,
            2
        ),
    };
}
