import prismadb from "@/lib/prismadb";
import { auth, useUser } from "@clerk/nextjs";
import { UserDocuments } from "@prisma/client";
import axios from "axios";
import { useEffect, useState } from "react";

interface UseGetUserDocs {
  userDocs: UserDocuments[] | undefined;
}

export const useGetUserDocs = (): UseGetUserDocs => {
  const [userDocs, setUserDocs] = useState<UserDocuments[] | undefined>(
    undefined
  );
  const { isSignedIn, user, isLoaded } = useUser();
  useEffect(() => {
    (async () => {
      if (user && user.id) {
        const response = await axios.get("/api/pdf/get-user-docs");
        setUserDocs(response.data.data);
      }
    })();
  }, [user]);

  return {
    userDocs,
  };
};
