import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LanguageButton() {
  const { t, i18n } = useTranslation();
  const toggle = () => {
    const language = i18n.language.startsWith("zh") ? "en" : "zh";
    const url = new URL(window.location.href);
    if (language === "en") url.searchParams.set("lang", "en");
    else url.searchParams.delete("lang");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    localStorage.setItem("language", language);
    void i18n.changeLanguage(language);
  };
  return <Button className="language-button" size="sm" variant="ghost" onClick={toggle} aria-label={t("language")}>
    <Languages /><span>{t("language")}</span>
  </Button>;
}
