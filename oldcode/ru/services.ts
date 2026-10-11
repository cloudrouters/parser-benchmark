
export type RuService = {
    name: string;
    url: string;
    challengeStatus: number;
    suspiciousActivityTexts: readonly string[];
    expectedContent: readonly string[];
   };
   
   
   export const RU_SERVICES: readonly RuService[] = [
    {
      name: "Wildberries",
      url: "https://www.wildberries.ru/",
      challengeStatus: 498,
      suspiciousActivityTexts: [
        "подозрительная активность",
        "подозрительную активность",
        "доступ ограничен",
        "проверка безопасности",
        "robot check",
      ],
      expectedContent: ["wildberries"],
    },
   ];
   
   
   export type RuPageSnapshot = {
    url: string;
    title: string;
    body: string;
    status: number | null;
    readyState: string;
    htmlLength: number;
    productLinks: number;
    images: number;
   };
   
   
   export type RuPageCheck = {
    contentSuccess: boolean;
    challenge: boolean;
   };
   
   
   export function checkRuServicePage(
    service: RuService,
    page: RuPageSnapshot
   ): RuPageCheck {
    const title = page.title.toLowerCase();
    const body = page.body.toLowerCase();
    const text = `${title}\n${body}`;
   
   
    const suspiciousActivity = service.suspiciousActivityTexts.some((phrase) =>
      text.includes(phrase.toLowerCase())
    );
   
   
    const expectedContent = service.expectedContent.some(
      (phrase) =>
        title.includes(phrase.toLowerCase()) ||
        body.includes(phrase.toLowerCase())
    );
   
   
    const hasProductLinks =
      service.name !== "Wildberries" || page.productLinks > 0;
   
   
    const pageContentLoaded =
      expectedContent &&
      hasProductLinks &&
      page.htmlLength > 0 &&
      page.readyState !== "loading";
   
   
    const successfulHttpStatus =
      page.status !== null && page.status >= 200 && page.status < 400;
   
   
    // A 498 response may be followed by successful client-side resolution.
    // Actual loaded content takes precedence over the original navigation status.
    const contentSuccess =
      pageContentLoaded &&
      !suspiciousActivity &&
      (successfulHttpStatus || page.status === service.challengeStatus);
   
   
    // A 498 is considered an unresolved challenge only while the expected
    // content has not loaded. Explicit security/challenge text remains a failure.
    const challenge =
      suspiciousActivity ||
      (page.status === service.challengeStatus && !contentSuccess);
   
   
    return {
      contentSuccess,
      challenge,
    };
   }
   
   
   
   