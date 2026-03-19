import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { Heading } from "@/components/Heading";
import { Button } from "@/components/ui/button";
import { axiosClient } from "../lib/axios";

const ImagePage = () => {
  const [prompt, setPrompt] = useState("");
  const [amount, setAmount] = useState("1");
  const [resolution, setResolution] = useState("512x512");
  const [images, setImages] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const onSubmit = async () => {
    if (!prompt) return;

    try {
      setImages([]);
      setIsLoading(true);

      const response = await axiosClient.post("/image", {
        prompt,
        amount,
        resolution,
      });

      const urls = response.data.map((image: { url: string }) => image.url);
      setImages(urls);
    } catch (error) {
      console.error("[IMAGE_ERROR]", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <Heading
        title="Image Generation"
        description="Turn your prompt into an image."
        icon={ImageIcon}
        iconColor="text-pink-700"
        bgColor="bg-pink-700/10"
      />
      <div className="px-4 lg:px-8 pb-10">
        <div className="grid w-full grid-cols-12 gap-2 rounded-xl border border-border bg-card p-4 px-3 shadow-sm transition-shadow focus-within:shadow-md md:px-6">
          <input
            className="col-span-12 border-0 bg-transparent text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-transparent lg:col-span-6"
            placeholder="A picture of a horse in Swiss alps"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isLoading}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onSubmit();
              }
            }}
          />
          <select
            className="col-span-12 rounded-md border border-input bg-background p-2 text-foreground outline-none focus:ring-2 focus:ring-pink-500/20 lg:col-span-2"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isLoading}
          >
            <option value="1">1 Photo</option>
            <option value="2">2 Photos</option>
            <option value="3">3 Photos</option>
            <option value="4">4 Photos</option>
            <option value="5">5 Photos</option>
          </select>
          <select
            className="col-span-12 rounded-md border border-input bg-background p-2 text-foreground outline-none focus:ring-2 focus:ring-pink-500/20 lg:col-span-2"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            disabled={isLoading}
          >
            <option value="256x256">256x256</option>
            <option value="512x512">512x512</option>
            <option value="1024x1024">1024x1024</option>
          </select>
          <Button
            className="col-span-12 lg:col-span-2 w-full bg-pink-600 hover:bg-pink-700 text-white"
            onClick={onSubmit}
            disabled={isLoading || !prompt}
          >
            Generate
          </Button>
        </div>
        <div className="space-y-4 mt-8">
          {images.length === 0 && !isLoading && (
            <div className="flex w-full items-center justify-center rounded-xl border border-border bg-card p-8 text-muted-foreground">
              No images generated.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-8">
            {images.map((src) => (
              <div key={src} className="overflow-hidden rounded-xl border border-border bg-card p-2 shadow-sm transition hover:shadow-md">
                <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                  <img src={src} alt="Generated" className="object-cover w-full h-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImagePage;
