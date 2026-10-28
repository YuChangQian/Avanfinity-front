import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Navigate, Outlet } from "@tanstack/react-router";
import { AppShell } from "./components/AppShell";
import { SeoMetadata } from "./components/SeoMetadata";

const CdkV2Page = lazyRouteComponent(() => import("./views/CdkV2Page"), "CdkV2Page");
const CdkV2RedeemPage = lazyRouteComponent(() => import("./views/CdkV2RedeemPage"), "CdkV2RedeemPage");
const LoginPage = lazyRouteComponent(() => import("./views/LoginPage"), "LoginPage");
const LandingPage = lazyRouteComponent(() => import("./views/LandingPage"), "LandingPage");
const TelegramLoginPage = lazyRouteComponent(() => import("./views/TelegramLoginPage"), "TelegramLoginPage");
const TelegramPaymentPage = lazyRouteComponent(() => import("./views/TelegramPaymentPage"), "TelegramPaymentPage");
const DashboardPage = lazyRouteComponent(() => import("./views/DashboardPage"), "DashboardPage");
const FinancePage = lazyRouteComponent(() => import("./views/FinancePage"), "FinancePage");
const CardsPage = lazyRouteComponent(() => import("./views/CardsPage"), "CardsPage");
const CardTransactionsPage = lazyRouteComponent(() => import("./views/CardTransactionsPage"), "CardTransactionsPage");
const DepositPage = lazyRouteComponent(() => import("./views/DepositPage"), "DepositPage");
const RegisterPage = lazyRouteComponent(() => import("./views/RegisterPage"), "RegisterPage");
const RewardsPage = lazyRouteComponent(() => import("./views/RewardsPage"), "RewardsPage");
const ReferralPage = lazyRouteComponent(() => import("./views/ReferralPage"), "ReferralPage");
const MembershipPage = lazyRouteComponent(() => import("./views/MembershipPage"), "MembershipPage");
const SettingsPage = lazyRouteComponent(() => import("./views/SettingsPage"), "SettingsPage");
const DeveloperPage = lazyRouteComponent(() => import("./views/DeveloperPage"), "DeveloperPage");
const AdminPage = lazyRouteComponent(() => import("./views/AdminPage"), "AdminPage");
const AgentPage = lazyRouteComponent(() => import("./views/AgentPage"), "AgentPage");
const MarketPage = lazyRouteComponent(() => import("./views/MarketPage"), "MarketPage");
const CardDetailPage = lazyRouteComponent(() => import("./views/CardDetailPage"), "CardDetailPage");
const OpenCardPage = lazyRouteComponent(() => import("./views/OpenCardPage"), "OpenCardPage");
const TgDirectPage = lazyRouteComponent(() => import("./views/TgDirectPage"), "TgDirectPage");
const GptDirectPage = lazyRouteComponent(() => import("./views/GptDirectPage"), "GptDirectPage");
const GptDirectOrderPage = lazyRouteComponent(() => import("./views/GptDirectOrderPage"), "GptDirectOrderPage");
const GptCdkRedeemPage = lazyRouteComponent(() => import("./views/GptCdkRedeemPage"), "GptCdkRedeemPage");
const TgCdkRedeemPage = lazyRouteComponent(() => import("./views/TgCdkRedeemPage"), "TgCdkRedeemPage");
const VerifyEmailPage = lazyRouteComponent(() => import("./views/VerifyEmailPage"), "VerifyEmailPage");
const ForgotPasswordPage = lazyRouteComponent(() => import("./views/ForgotPasswordPage"), "ForgotPasswordPage");
const ResetPasswordPage = lazyRouteComponent(() => import("./views/ResetPasswordPage"), "ResetPasswordPage");
const MfaSetupPage = lazyRouteComponent(() => import("./views/MfaSetupPage"), "MfaSetupPage");
const AnnouncementsPage = lazyRouteComponent(() => import("./views/AnnouncementsPage"), "AnnouncementsPage");
const SupportTicketsPage = lazyRouteComponent(() => import("./views/SupportTicketsPage"), "SupportTicketsPage");
const TermsPage = lazyRouteComponent(() => import("./views/LegalDocumentPage"), "TermsPage");
const UserAgreementPage = lazyRouteComponent(() => import("./views/LegalDocumentPage"), "UserAgreementPage");

const rootRoute = createRootRoute({ component: () => <><SeoMetadata /><Outlet /></> });
const gptRetrySearch = (search: Record<string, unknown>): { gptRetry?: boolean } =>
  search.gptRetry === true || search.gptRetry === "true" || search.gptRetry === "1" ? { gptRetry: true } : {};
const gptDirectSearch = (search: Record<string, unknown>): { cardId?: number } => {
  const cardId = Number(search.cardId);
  return Number.isSafeInteger(cardId) && cardId > 0 ? { cardId } : {};
};
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: LandingPage });
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: LoginPage });
const telegramLoginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/telegram-login", component: TelegramLoginPage });
const telegramPaymentRoute = createRoute({ getParentRoute: () => rootRoute, path: "/telegram-payment", component: TelegramPaymentPage });
const registerRoute = createRoute({ getParentRoute: () => rootRoute, path: "/register", component: RegisterPage });
const inviteRoute = createRoute({ getParentRoute: () => rootRoute, path: "/invite/$inviteCode", component: RegisterPage });
const shortInviteRoute = createRoute({ getParentRoute: () => rootRoute, path: "/r/$inviteCode", component: RegisterPage });
const registerInviteRoute = createRoute({ getParentRoute: () => rootRoute, path: "/register/invite/$inviteCode", component: RegisterPage });
const verifyEmailRoute = createRoute({ getParentRoute: () => rootRoute, path: "/verify-email", component: VerifyEmailPage });
const forgotPasswordRoute = createRoute({ getParentRoute: () => rootRoute, path: "/forgot-password", component: ForgotPasswordPage });
const resetPasswordRoute = createRoute({ getParentRoute: () => rootRoute, path: "/reset-password", component: ResetPasswordPage });
const termsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/terms", component: TermsPage });
const userAgreementRoute = createRoute({ getParentRoute: () => rootRoute, path: "/user-agreement", component: UserAgreementPage });
const mfaSetupRoute = createRoute({ getParentRoute: () => rootRoute, path: "/mfa/setup", component: MfaSetupPage });
const appRoute = createRoute({ getParentRoute: () => rootRoute, id: "app", component: AppShell });
const gptCdkRedeemRoute = createRoute({ getParentRoute: () => appRoute, path: "/cdk/redeem", component: GptCdkRedeemPage });
const xCdkRedeemRoute = createRoute({ getParentRoute: () => appRoute, path: "/x-cdk/redeem", component: () => <Navigate to="/" replace /> });
const tgCdkRedeemRoute = createRoute({ getParentRoute: () => appRoute, path: "/tg-cdk/redeem", component: TgCdkRedeemPage });
const cdkV2Route = createRoute({ getParentRoute: () => appRoute, path: "/cdk-v2", component: CdkV2Page });
const unifiedRedeemRoute = createRoute({ getParentRoute: () => rootRoute, path: "/redeem", component: CdkV2RedeemPage });
const dashboardRoute = createRoute({ getParentRoute: () => appRoute, path: "/dashboard", component: DashboardPage });
const financeRoute = createRoute({ getParentRoute: () => appRoute, path: "/finance", component: FinancePage });
const cardsRoute = createRoute({ getParentRoute: () => appRoute, path: "/cards", validateSearch: gptRetrySearch, component: CardsPage });
const ownedCardsRoute = createRoute({ getParentRoute: () => appRoute, path: "/cards/owned", component: CardsPage });
const cardTransactionsRoute = createRoute({ getParentRoute: () => appRoute, path: "/card-transactions", component: CardTransactionsPage });
const openCardRoute = createRoute({ getParentRoute: () => appRoute, path: "/cards/open/$productCode", validateSearch: gptRetrySearch, component: OpenCardPage });
const cardDetailRoute = createRoute({ getParentRoute: () => appRoute, path: "/cards/$cardId", component: CardDetailPage });
const depositRoute = createRoute({ getParentRoute: () => appRoute, path: "/deposit", component: DepositPage });
const rewardsRoute = createRoute({ getParentRoute: () => appRoute, path: "/rewards", component: RewardsPage });
const lotteryRoute = createRoute({ getParentRoute: () => appRoute, path: "/lottery", component: () => <Navigate to="/rewards" /> });
const shopRoute = createRoute({ getParentRoute: () => appRoute, path: "/shop", component: () => <Navigate to="/rewards" /> });
const referralRoute = createRoute({ getParentRoute: () => appRoute, path: "/referral", component: ReferralPage });
const membershipRoute = createRoute({ getParentRoute: () => appRoute, path: "/membership", component: MembershipPage });
const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: "/settings", component: SettingsPage });
const announcementsRoute = createRoute({ getParentRoute: () => appRoute, path: "/announcements", component: AnnouncementsPage });
const supportTicketsRoute = createRoute({ getParentRoute: () => appRoute, path: "/support", component: SupportTicketsPage });
const developerRoute = createRoute({ getParentRoute: () => appRoute, path: "/developer", component: DeveloperPage });
const adminRoute = createRoute({ getParentRoute: () => appRoute, path: "/admin", component: AdminPage });
const agentRoute = createRoute({ getParentRoute: () => appRoute, path: "/agent", component: AgentPage });
const marketRoute = createRoute({ getParentRoute: () => appRoute, path: "/openai-prices", component: MarketPage });
const xDirectRoute = createRoute({ getParentRoute: () => appRoute, path: "/x-direct", component: () => <Navigate to="/dashboard" replace /> });
const tgDirectRoute = createRoute({ getParentRoute: () => appRoute, path: "/tg-direct", component: TgDirectPage });
const gptDirectRoute = createRoute({ getParentRoute: () => appRoute, path: "/gpt-direct", validateSearch: gptDirectSearch, component: GptDirectPage });
const gptDirectOrderRoute = createRoute({ getParentRoute: () => appRoute, path: "/gpt-direct/orders/$orderId", component: GptDirectOrderPage });

export const router = createRouter({
  routeTree: rootRoute.addChildren([
  unifiedRedeemRoute, indexRoute, loginRoute, telegramLoginRoute, telegramPaymentRoute, registerRoute, inviteRoute, shortInviteRoute, registerInviteRoute, verifyEmailRoute, forgotPasswordRoute, resetPasswordRoute, termsRoute, userAgreementRoute, mfaSetupRoute, appRoute.addChildren([
    cdkV2Route, dashboardRoute, financeRoute, cardsRoute, ownedCardsRoute, cardTransactionsRoute, openCardRoute, cardDetailRoute, depositRoute, rewardsRoute, lotteryRoute,
    shopRoute, referralRoute, membershipRoute, settingsRoute, announcementsRoute, supportTicketsRoute, developerRoute, adminRoute, agentRoute, marketRoute, tgDirectRoute, tgCdkRedeemRoute, xDirectRoute, gptDirectRoute, gptDirectOrderRoute, gptCdkRedeemRoute, xCdkRedeemRoute,
  ]),
  ]),
});

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}
