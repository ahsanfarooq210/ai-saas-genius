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

const PdfPage = () => {
  const proModal = useProModel();
  const router = useRouter();
  const [message, setmessage] = useState<ChatCompletionRequestMessage[]>([]);
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      prompt: "",
    },
  });
  const isLoading = form.formState.isSubmitting;

  useEffect(() => {
    try {
      const sendApiCall = async () => {
        await axios.post("/api/pdf", {});
      };
      sendApiCall();
    } catch (error: any) {
      console.log("pdf error", error.message);
    }
  }, []);

  return (
    <div>
      <Heading
        title="PDF chat"
        description="Upload any PDF and chat with it"
        icon={BookIcon}
        iconColor="text-red-600"
        bgColor="bg-red-500/10"
      />
      <div className="px-4 lg:px-8"></div>
    </div>
  );
};

export default PdfPage;
