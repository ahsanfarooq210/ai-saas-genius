"use client";
import Heading from "@/components/global/Heading";
import useProModel from "@/hooks/use-pro-model";
import { BookIcon, Loader } from "lucide-react";
import { useRouter } from "next/navigation";
import React from "react";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import useFileUpload from "@/hooks/useFileUpload";
import { useGetUserDocs } from "@/hooks/useGetUserDocs";
import { useUser } from "@clerk/nextjs";
import UserDocList from "@/components/pdf/UserDocsList";

const PdfPage = () => {
  const {
    progress,
    isProcessing,
    fileInputRef,
    handleOnFileSelect,
    isLoading,
  } = useFileUpload();

  const router = useRouter();

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

        {isLoading && (
          <>
            {isProcessing ? (
              <Loader className="animate-spin" />
            ) : (
              <Progress value={progress} />
            )}
          </>
        )}

        <div className="mt-7">
          <UserDocList />
        </div>
      </div>
    </div>
  );
};

export default PdfPage;
