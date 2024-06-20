import { useState, useRef } from "react";
import axios from "axios";

const useFileUpload = () => {
  const [progress, setProgress] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const uploadFile = async (file: File) => {
    try {
      setIsLoading(true);
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
      setIsLoading(false);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleOnFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    if (file) {
      uploadFile(file);
    }
  };

  return {
    progress,
    isProcessing,
    selectedFile,
    fileInputRef,
    handleOnFileSelect,
    isLoading,
  };
};

export default useFileUpload;
