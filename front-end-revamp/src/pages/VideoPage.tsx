import { useState } from "react";
import { VideoIcon } from "lucide-react";
import { Heading } from "@/components/Heading";
import { Button } from "@/components/ui/button";
import { axiosClient } from "../lib/axios";

const VideoPage = () => {
  const [prompt, setPrompt] = useState("");
  const [video, setVideo] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);

  const onSubmit = async () => {
    if (!prompt) return;

    try {
      setVideo(undefined);
      setIsLoading(true);

      const response = await axiosClient.post("/video", {
        prompt,
      });

      setVideo(response.data[0]);
    } catch (error) {
      console.error("[VIDEO_ERROR]", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <Heading
        title="Video Generation"
        description="Turn your prompt into video."
        icon={VideoIcon}
        iconColor="text-orange-700"
        bgColor="bg-orange-700/10"
      />
      <div className="px-4 lg:px-8 pb-10">
        <div className="grid w-full grid-cols-12 gap-2 rounded-xl border border-border bg-card p-4 px-3 shadow-sm transition-shadow focus-within:shadow-md md:px-6">
          <input
            className="col-span-12 border-0 bg-transparent text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-transparent lg:col-span-10"
            placeholder="Clown fish swimming around a coral reef"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isLoading}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onSubmit();
              }
            }}
          />
          <Button
            className="col-span-12 lg:col-span-2 w-full bg-orange-600 hover:bg-orange-700 text-white"
            onClick={onSubmit}
            disabled={isLoading || !prompt}
          >
            Generate
          </Button>
        </div>
        <div className="space-y-4 mt-8">
          {!video && !isLoading && (
            <div className="flex w-full items-center justify-center rounded-xl border border-border bg-card p-8 text-muted-foreground">
              No video generated.
            </div>
          )}
          {video && (
            <video controls className="mt-8 aspect-video w-full rounded-xl border border-border bg-card shadow-sm">
              <source src={video} />
            </video>
          )}
        </div>
      </div>
    </div>
  );
};

export default VideoPage;
