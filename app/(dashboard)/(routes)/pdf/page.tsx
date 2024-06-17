"use client";
import Heading from "@/components/Heading";
import useProModel from "@/hooks/use-pro-model";
import { BookIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { ChatCompletionRequestMessage } from "openai";
import React, { useEffect, useState } from "react";
import * as z from "zod";
import { formSchema } from "./constants";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import axios from "axios";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";

const PdfPage = () => {
  const [progress, setProgress] = useState<number>(0);
  const proModal = useProModel();
  const router = useRouter();

  const uploadFile = async (file: File) => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = axios.post("/api/pdf/upload-pdf", formData, {
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
          }
        },
      });
    } catch (error) {
      console.log(error);
    }
  };
  const handleOnFileSelect = async (file: File) => {
    uploadFile(file);
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
      <div className="px-4 lg:px-8 ">
        <Input
          type="file"
          accept=".pdf"
          className="h-max w-full flex justify-center"
          onChange={(event) => {
            console.log(event.target.files?.[0]);
            event.target.files?.[0] &&
              handleOnFileSelect(event.target.files[0]);
          }}
        />
      </div>
      <Progress value={progress} />
    </div>
  );
};

export default PdfPage;
