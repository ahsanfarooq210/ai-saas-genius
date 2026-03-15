import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { Heading } from "@/components/Heading";
import { Button } from "@/components/ui/button";
import { axiosClient } from "@/lib/axios";

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
      <div className="px-4 lg:px-8">
        <div className="rounded-lg border w-full p-4 px-3 md:px-6 focus-within:shadow-sm grid grid-cols-12 gap-2">
           <input
             className="col-span-12 lg:col-span-6 border-0 outline-none focus-visible:ring-0 focus-visible:ring-transparent bg-transparent"
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
             className="col-span-12 lg:col-span-2 p-2 border rounded bg-background"
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
             className="col-span-12 lg:col-span-2 p-2 border rounded bg-background"
             value={resolution}
             onChange={(e) => setResolution(e.target.value)}
             disabled={isLoading}
           >
             <option value="256x256">256x256</option>
             <option value="512x512">512x512</option>
             <option value="1024x1024">1024x1024</option>
           </select>
           <Button
             className="col-span-12 lg:col-span-2 w-full"
             onClick={onSubmit}
             disabled={isLoading || !prompt}
           >
              Generate
           </Button>
        </div>
        <div className="space-y-4 mt-4">
          {images.length === 0 && !isLoading && (
            <div className="p-8 rounded-lg w-full flex items-center justify-center bg-muted">
              No images generated.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-8">
            {images.map((src) => (
              <div key={src} className="rounded-lg overflow-hidden border">
                <div className="relative aspect-square">
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
