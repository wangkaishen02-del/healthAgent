import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import { Roles } from "../auth/auth.decorators.ts";
import { prisma } from "../../../../src/db/prisma.ts";

const types = ["disease_icd10", "administrative_area"] as const;

@Controller("reference-data")
@Roles("claim_acceptor", "claim_calculator", "claim_reviewer", "claim_viewer")
export class ReferenceDataController {
  @Get()
  async search(@Query("type") type?: string, @Query("keyword") rawKeyword?: string) {
    if (!types.includes(type as (typeof types)[number])) throw new BadRequestException("invalid_reference_data_type");
    const keyword = rawKeyword?.trim() ?? "";
    const items = await prisma.systemDictionary.findMany({
      where: {
        dictionaryType: type,
        enabled: true,
        ...(keyword ? { OR: [{ itemCode: { contains: keyword, mode: "insensitive" } }, { itemName: { contains: keyword, mode: "insensitive" } }] } : {}),
      },
      orderBy: [{ sequenceNo: "asc" }, { itemCode: "asc" }],
      take: 20,
      select: { itemCode: true, itemName: true, description: true },
    });
    return { items };
  }
}
