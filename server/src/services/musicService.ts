import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN || "",
});

export const generateMusic = async (prompt: string) => {
  const response = await replicate.run(
    "riffusion/riffusion:8cf61ea6c56afd61d8f5b9ffd14d7c216c0a93844ce2d82ac1c9ecc9c7f24e05",
    {
      input: {
        prompt_a: prompt,
      },
    }
  );
  return response;
};
