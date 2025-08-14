import { assertEquals, assertThrows } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { parseEmailResponse } from '../_shared/claude-api.ts';

Deno.test("parseEmailResponse - handles well-formed JSON with escaped newlines", () => {
    const validJson = `{
  "subject": "Saw your truck on Denver Downtown Area",
  "body": "Hi John,\\n\\nI spotted one of your ABC Plumbing Services trucks on Denver Downtown Area earlier today (pic attached). A sharp-looking fleet is always a good sign.\\n\\nMy firm, Good Hope Advisors, specializes in helping owners in the plumbing industry achieve a successful exit. Whether you're planning an exit in the near future or 3-5 years down the road, I'm happy to share some insights on what is currently driving valuations.\\n\\nWould you be open to a brief, no-obligation call next week to discuss your long-term goals?\\n\\nBest,\\nIzzy"
}`;

    const result = parseEmailResponse(validJson);
    
    assertEquals(result.subject, "Saw your truck on Denver Downtown Area");
    assertEquals(result.body.includes("Hi John,"), true);
    assertEquals(result.body.includes("ABC Plumbing Services"), true);
});

Deno.test("parseEmailResponse - handles real problematic LLM output with unescaped newlines", () => {
    // This is the actual raw response that was causing errors
    const problematicJson = `{
  "subject": "Saw your truck on Denver Downtown Area",
  "body": "Hi John,

I spotted one of your ABC Plumbing Services trucks on Denver Downtown Area earlier today (pic attached). A sharp-looking fleet is always a good sign.

My firm, Good Hope Advisors, specializes in helping owners in the plumbing industry achieve a successful exit. Whether you're planning an exit in the near future or 3-5 years down the road, I'm happy to share some insights on what is currently driving valuations.

Would you be open to a brief, no-obligation call next week to discuss your long-term goals?

Best,
Izzy"
}`;

    const result = parseEmailResponse(problematicJson);
    
    assertEquals(result.subject, "Saw your truck on Denver Downtown Area");
    assertEquals(result.body.includes("Hi John,"), true);
    assertEquals(result.body.includes("ABC Plumbing Services"), true);
});

Deno.test("parseEmailResponse - handles another real LLM output from logs", () => {
    const anotherRealOutput = `{
  "subject": "Saw your truck on Main Street",
  "body": "Hi Thomas,

I spotted one of your Able Mechanical Inc trucks on Main Street earlier today (pic attached). A sharp-looking fleet is always a good sign. 
My firm, Good Hope Advisors, specializes in helping owners in the hvac industry achieve a successful exit. 
Whether you're planning an exit in the near future or 3-5 years down the road, I'm happy to share some insights on what is currently driving valuations.

Would you be open to a brief, no-obligation call next week to discuss your long-term goals?

Best,
Izzy"
}`;

    const result = parseEmailResponse(anotherRealOutput);
    
    assertEquals(result.subject, "Saw your truck on Main Street");
    assertEquals(result.body.includes("Hi Thomas,"), true);
    assertEquals(result.body.includes("Able Mechanical Inc"), true);
});

Deno.test("parseEmailResponse - handles working LLM output with proper escaping", () => {
    const workingOutput = `{
  "subject": "Saw your truck on New Jersey Turnpike",
  "body": "Hi Walter,\\n\\nI spotted one of your HVAC Services LLC trucks on the New Jersey Turnpike earlier today (pic attached). A sharp-looking fleet is always a good sign.\\n\\nMy firm, Good Hope Advisors, specializes in helping owners in the plumbing, heating, and air-conditioning industry achieve a successful exit. Whether you're planning an exit in the near future or 3-5 years down the road, I'm happy to share some insights on what is currently driving valuations.\\n\\nWould you be open to a brief, no-obligation call next week to discuss your long-term goals?\\n\\nBest,\\nIzzy"
}`;

    const result = parseEmailResponse(workingOutput);
    
    assertEquals(result.subject, "Saw your truck on New Jersey Turnpike");
    assertEquals(result.body.includes("Hi Walter,"), true);
    assertEquals(result.body.includes("HVAC Services LLC"), true);
});

Deno.test("parseEmailResponse - throws error on missing subject", () => {
    const missingSubject = `{
  "body": "Hi there, this is a test message."
}`;

    assertThrows(
        () => parseEmailResponse(missingSubject),
        Error,
        "Missing subject or body in JSON response"
    );
});

Deno.test("parseEmailResponse - throws error on missing body", () => {
    const missingBody = `{
  "subject": "Test Subject"
}`;

    assertThrows(
        () => parseEmailResponse(missingBody),
        Error,
        "Missing subject or body in JSON response"
    );
});

Deno.test("parseEmailResponse - throws error on invalid JSON", () => {
    const invalidJson = `{
  "subject": "Test Subject",
  "body": "This is not valid JSON because of the trailing comma",
}`;

    assertThrows(
        () => parseEmailResponse(invalidJson),
        Error,
        "Could not parse JSON response from Claude API"
    );
});

Deno.test("parseEmailResponse - handles tabs and carriage returns", () => {
    const jsonWithSpecialChars = `{
  "subject": "Test	Subject",
  "body": "Line 1
Line 2	with tab
Line 3"
}`;

    const result = parseEmailResponse(jsonWithSpecialChars);
    
    assertEquals(result.subject, "Test	Subject");
    assertEquals(result.body.includes("Line 1"), true);
    assertEquals(result.body.includes("with tab"), true);
});