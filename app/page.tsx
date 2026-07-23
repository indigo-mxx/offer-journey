import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from "./chatgpt-auth";
import { RecruitmentTracker } from "./recruitment-tracker";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return (
    <RecruitmentTracker
      user={user}
      signInPath={chatGPTSignInPath("/")}
      signOutPath={chatGPTSignOutPath("/")}
    />
  );
}
