import { useQuery } from "@tanstack/react-query";
import { getFeatures, type FeatureFlags } from "./api";

export const defaultFeatureFlags: FeatureFlags = {
  version: 0,
  registration: false,
  walletTransfer: false,
  cardOpening: false,
  cardRecharge: false,
  cardManagement: false,
  cardDelete: false,
  gptDirect: false,
  gptCdk: false,
  deposits: false,
  rewards: false,
  agent: false,
  market: false,
  developerApi: false,
  telegram: false,
};

export function useFeatures() {
  const query = useQuery({
    queryKey: ["features"],
    queryFn: getFeatures,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });
  return { ...query, flags: query.data?.data ?? defaultFeatureFlags };
}
