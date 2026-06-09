type TemporarySchemaComments = Record<
  string,
  {
    table: string;
    columns: Record<string, string>;
  }
>;

export const temporarySchemaComments: TemporarySchemaComments = {
  malls: {
    table: '包含商场相关信息的表',
    columns: {
      id: '商场的ID，公司内部使用，与客户无关',
      name: '商场名称',
      district: '商场所在行政区',
      city: "商场所在城市，正式名称，以'市'结尾",
      province: '商场所在省份',
      address: '商场具体地址',
      open_date: '商场开业日期，可能记录不全',
      开发商集团: '商场开发商所属集团名称',
      商场定位: '通过算法得到的对商场的定位，属于对商场的评价指标之一',
      商场评级: '通过算法得到的对商场的评级，属于对商场的评价指标之一',
      商圈: '商场所在商圈',
      商圈评级: '通过算法得到的对商场所在商圈的评级，属于对商圈的评价指标之一',
      area: '商场面积，数据可能有缺失',
    },
  },
  stores: {
    table: '包含门店及其品牌相关信息的表',
    columns: {
      id: '门店ID，公司内部使用，与客户无关',
      sku: '门店品牌SKU，公司内部使用，与客户无关',
      brand_name: '门店品牌名称（英文）',
      brand_name_cn: '门店品牌名称（中文）',
      category_cn: '门店品牌所属类别（中文）',
      category: '门店品牌所属类别（英文）',
      mall_id: '门店所在商场的ID，对应malls表里的id一列',
      floor: '门店所在楼层，数据未完全清洗',
    },
  },
};
