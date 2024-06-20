"use client";
import Heading from "@/components/Heading";
import useProModel from "@/hooks/use-pro-model";
import { BookIcon, Loader } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useState, useRef } from "react";
import axios from "axios";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";

const PdfPage = () => {
  const [progress, setProgress] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const proModal = useProModel();
  const router = useRouter();

  const uploadFile = async (file: File) => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await axios.post("/api/pdf/upload-pdf", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        onUploadProgress: (progressEvent) => {
          if (progressEvent) {
            const progress = Math.round(
              (progressEvent.loaded * 100) / (progressEvent.total ?? 1)
            );
            console.log(`Upload Progress: ${progress}%`);
            setProgress(progress);
            if (progressEvent.total === progressEvent.loaded) {
              setIsProcessing(true);
              setProgress(100);
            }
          }
        },
      });
      setIsProcessing(false);
    } catch (error) {
      console.log(error);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleOnFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0] || null;
    if (file) {
      uploadFile(file);
    }
  };

  return (
    <div>
      <Heading
        title="PDF chat"
        description="Upload any PDF and chat with it"
        icon={BookIcon}
        iconColor="text-red-600"
        bgColor="bg-red-500/10"
      />
      <div className="px-4 lg:px-8 flex flex-col gap-5">
        <Input
          type="file"
          accept=".pdf"
          className="h-max w-full flex justify-center"
          onChange={handleOnFileSelect}
          ref={fileInputRef}
        />

        {isProcessing ? (
          <Loader className="animate-spin" />
        ) : (
          <Progress value={progress} />
        )}
      </div>
    </div>
  );
};

export default PdfPage;
