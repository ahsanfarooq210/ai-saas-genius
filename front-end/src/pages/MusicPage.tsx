import { useState } from "react";
import { Music } from "lucide-react";
import { Heading } from "@/components/Heading";
import { Button } from "@/components/ui/button";
import { axiosClient } from "@/lib/axios";

const MusicPage = () => {
  const [prompt, setPrompt] = useState("");
  const [music, setMusic] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);

  const onSubmit = async () => {
    if (!prompt) return;

    try {
      setMusic(undefined);
      setIsLoading(true);

      const response = await axiosClient.post("/music", {
        prompt,
      });

      setMusic(response.data.audio);
    } catch (error) {
      console.error("[MUSIC_ERROR]", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <Heading
        title="Music Generation"
        description="Turn your prompt into music."
        icon={Music}
        iconColor="text-emerald-500"
        bgColor="bg-emerald-500/10"
      />
      <div className="px-4 lg:px-8">
        <div className="rounded-lg border w-full p-4 px-3 md:px-6 focus-within:shadow-sm grid grid-cols-12 gap-2">
           <input
             className="col-span-12 lg:col-span-10 border-0 outline-none focus-visible:ring-0 focus-visible:ring-transparent bg-transparent"
             placeholder="Piano solo"
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
             className="col-span-12 lg:col-span-2 w-full"
             onClick={onSubmit}
             disabled={isLoading || !prompt}
           >
              Generate
           </Button>
        </div>
        <div className="space-y-4 mt-4">
          {!music && !isLoading && (
            <div className="p-8 rounded-lg w-full flex items-center justify-center bg-muted">
              No music generated.
            </div>
          )}
          {music && (
            <audio controls className="w-full mt-8">
              <source src={music} />
            </audio>
          )}
        </div>
      </div>
    </div>
  );
};

export default MusicPage;
