import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react";

export function HumanoidRobot() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Bot className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">{t('humanoid.title')}</h1>
      </header>
      <div className="flex-1 p-6">
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          <p className="text-sm">{t('humanoid.placeholder')}</p>
        </div>
      </div>
    </div>
  );
}
